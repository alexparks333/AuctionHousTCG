package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Self-serve account deletion (CCPA-style "delete my data").
//
// The users row itself is never removed: orders, reviews, claims, payouts,
// messages and tier history all reference it by foreign key, and those
// records have to keep working for the other party in each transaction,
// for tax records, and for chargeback/dispute defence. So deletion means:
//
//   - refuse while the account still has business in flight (DeletionBlockers);
//   - end everything that's still live (unsold listings, Singles Shop stock,
//     pending offers and second-chance offers);
//   - delete data that only ever served the account holder (addresses,
//     watchlist, notifications, phone-upload sessions);
//   - scrub the row's personal data and stamp deleted_at — username goes
//     to NULL, which every display path already renders as "Deleted user" /
//     "Someone", and email becomes a unique non-routable placeholder so the
//     real address is free to sign up again;
//   - delete their photos except those of listings that sold (deletePhotos);
//   - delete the Supabase Auth login (deleteAuthUser), so the account can
//     never be signed into again.
//
// Deliberately kept: identity_fingerprint_hash and account_suspensions, so
// deleting an account can't be used to dodge a ban (an HMAC, never the raw
// ID number — see internal/webhook); stripe_account_id/stripe_customer_id,
// which point at records Stripe itself must retain; and the transaction
// history described above.

// ErrDeletionBlocked means the account still has business in flight; the
// accompanying blockers (from DeletionBlockers) say what.
var ErrDeletionBlocked = errors.New("account has open activity")

// DeletionBlockers lists, in plain language, everything that has to finish
// before this account can be deleted. Empty means it's clear to delete.
func DeletionBlockers(ctx context.Context, pool *pgxpool.Pool, userID string) ([]string, error) {
	var openBuys, openSales, openClaims, liveAuctions, leading, unpaidWins, unpaidSales int
	err := pool.QueryRow(ctx, `
		select
			(select count(*) from orders
				where buyer_id = $1 and state not in ('released', 'refunded', 'cancelled')),
			(select count(*) from orders
				where seller_id = $1 and state not in ('released', 'refunded', 'cancelled')),
			(select count(*) from claims c join orders o on o.id = c.order_id
				where (o.buyer_id = $1 or o.seller_id = $1) and c.state not in ('decided', 'closed')),
			(select count(*) from listings l join auctions a on a.listing_id = l.id
				where l.seller_id = $1 and l.status = 'active' and a.bid_count > 0),
			(select count(*) from listings l join auctions a on a.listing_id = l.id
				where a.high_bidder_id = $1 and l.status = 'active'),
			(select count(*) from auctions a
				where a.high_bidder_id = $1 and a.outcome = 'sold' and a.paid_at is null and a.cancel_reason is null),
			(select count(*) from auctions a join listings l on l.id = a.listing_id
				where l.seller_id = $1 and a.outcome = 'sold' and a.paid_at is null and a.cancel_reason is null)
	`, userID).Scan(&openBuys, &openSales, &openClaims, &liveAuctions, &leading, &unpaidWins, &unpaidSales)
	if err != nil {
		return nil, fmt.Errorf("check deletion blockers: %w", err)
	}

	var blockers []string
	add := func(n int, one, many string) {
		switch {
		case n == 1:
			blockers = append(blockers, one)
		case n > 1:
			blockers = append(blockers, fmt.Sprintf(many, n))
		}
	}
	add(openBuys, "1 purchase that hasn't been delivered and completed yet", "%d purchases that haven't been delivered and completed yet")
	add(openSales, "1 sale that hasn't been shipped and completed yet", "%d sales that haven't been shipped and completed yet")
	add(openClaims, "1 open claim", "%d open claims")
	add(liveAuctions, "1 auction of yours that already has bids", "%d auctions of yours that already have bids")
	add(leading, "1 auction you're currently the high bidder on", "%d auctions you're currently the high bidder on")
	add(unpaidWins, "1 auction you won but haven't paid for", "%d auctions you won but haven't paid for")
	add(unpaidSales, "1 sold auction still waiting on the buyer's payment", "%d sold auctions still waiting on the buyer's payment")
	return blockers, nil
}

// DeleteAccount ends and scrubs the account in one transaction, then deletes
// its Supabase Auth login. Safe to call again on an already-deleted account
// (it only retries the login deletion), so a failure on that last step can
// be recovered by the user simply trying again.
func DeleteAccount(ctx context.Context, pool *pgxpool.Pool, supabaseURL, serviceRoleKey, userID string) ([]string, error) {
	var alreadyDeleted bool
	if err := pool.QueryRow(ctx, `select deleted_at is not null from users where id = $1`, userID).Scan(&alreadyDeleted); err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}

	if !alreadyDeleted {
		blockers, err := DeletionBlockers(ctx, pool, userID)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return blockers, ErrDeletionBlocked
		}
		if err := scrubAccount(ctx, pool, userID); err != nil {
			return nil, err
		}
	}

	// Best-effort: a storage hiccup shouldn't leave the account half
	// deleted. Running again (the already-deleted path above) retries it.
	if err := deletePhotos(ctx, pool, supabaseURL, serviceRoleKey, userID); err != nil {
		log.Printf("delete account: photo cleanup failed for user %s: %v", userID, err)
	}
	if err := deleteAuthUser(ctx, supabaseURL, serviceRoleKey, userID); err != nil {
		return nil, err
	}
	return nil, nil
}

// deletePhotos removes the account's uploaded photos from Storage, except
// the ones that belong to a listing that sold. Those stay: they're part of
// the buyer's order history and evidence for any claim or chargeback. That
// leaves photos of unsold and cancelled listings, uploads that never made it
// into a listing, and the retired profile-canvas images.
func deletePhotos(ctx context.Context, pool *pgxpool.Pool, supabaseURL, serviceRoleKey, userID string) error {
	const listingBucket = "listing-photos"
	publicPrefix := "/storage/v1/object/public/" + listingBucket + "/"

	// Every photo URL a sold listing uses or used (edit history included).
	rows, err := pool.Query(ctx, `
		with sold as (
			select l.id, l.image_urls from listings l
			where l.seller_id = $1 and (
				l.status = 'sold'
				or exists (select 1 from order_items oi where oi.listing_id = l.id)
				or exists (select 1 from order_addons oa where oa.listing_id = l.id)
			)
		)
		select unnest(image_urls) from sold
		union select unnest(e.before_image_urls) from listing_photo_edits e join sold on sold.id = e.listing_id
		union select unnest(e.after_image_urls) from listing_photo_edits e join sold on sold.id = e.listing_id`, userID)
	if err != nil {
		return fmt.Errorf("load kept photos: %w", err)
	}
	keep := map[string]bool{}
	for rows.Next() {
		var url *string
		if err := rows.Scan(&url); err != nil {
			rows.Close()
			return err
		}
		if url != nil {
			if i := strings.Index(*url, publicPrefix); i >= 0 {
				keep[(*url)[i+len(publicPrefix):]] = true
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, bucket := range []string{listingBucket, "profile-canvas"} {
		// Read-only listing of the user's folder; the deletes themselves go
		// through the Storage API so the files are really removed.
		rows, err := pool.Query(ctx,
			`select name from storage.objects where bucket_id = $1 and name like $2 || '/%'`, bucket, userID)
		if err != nil {
			return fmt.Errorf("list %s: %w", bucket, err)
		}
		var doomed []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return err
			}
			if !(bucket == listingBucket && keep[name]) {
				doomed = append(doomed, name)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for len(doomed) > 0 {
			n := min(len(doomed), 100)
			if err := deleteStorageObjects(ctx, supabaseURL, serviceRoleKey, bucket, doomed[:n]); err != nil {
				return err
			}
			doomed = doomed[n:]
		}
	}
	return nil
}

func deleteStorageObjects(ctx context.Context, supabaseURL, serviceRoleKey, bucket string, paths []string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string][]string{"prefixes": paths})
	url := strings.TrimRight(supabaseURL, "/") + "/storage/v1/object/" + bucket
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", serviceRoleKey)
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete %s photos: %w", bucket, err)
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("delete %s photos: storage returned %d: %s", bucket, res.StatusCode, msg)
	}
	return nil
}

func scrubAccount(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	statements := []string{
		// Anything still for sale comes down. DeletionBlockers already
		// refused auctions with bids, so these are all unbid.
		`update listings set status = 'cancelled' where seller_id = $1 and status = 'active'`,
		`update shop_singles set removed_at = now() where seller_id = $1 and removed_at is null`,
		`update offers set status = 'withdrawn', responded_at = now() where buyer_id = $1 and status = 'pending'`,
		`update offers set status = 'declined', responded_at = now() where seller_id = $1 and status = 'pending'`,
		`update second_chance_offers set status = 'expired' where (bidder_id = $1 or seller_id = $1) and status = 'pending'`,
		// Data that only ever existed for the account holder.
		`delete from addresses where user_id = $1`,
		`delete from watchlist where user_id = $1`,
		`delete from notifications where user_id = $1`,
		`delete from photo_upload_sessions where user_id = $1`,
		`update users set
			email = 'deleted+' || id::text || '@deleted.invalid',
			username = null,
			bio = null,
			phone_number = null,
			email_verification_code = null,
			email_verification_sent_at = null,
			stripe_identity_session_id = null,
			profile_stickers = '[]'::jsonb,
			profile_widgets = '[]'::jsonb,
			profile_canvas = null,
			deleted_at = now()
		where id = $1`,
	}
	for _, s := range statements {
		if _, err := tx.Exec(ctx, s, userID); err != nil {
			return fmt.Errorf("delete account: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// deleteAuthUser removes the Supabase Auth user (password and any Google
// identity), so the account can't be signed into again. A 404 means it's
// already gone, which counts as success.
func deleteAuthUser(ctx context.Context, supabaseURL, serviceRoleKey, userID string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	url := strings.TrimRight(supabaseURL, "/") + "/auth/v1/admin/users/" + userID
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", serviceRoleKey)
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete auth user: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode/100 == 2 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
	return fmt.Errorf("delete auth user: supabase returned %d: %s", res.StatusCode, body)
}
