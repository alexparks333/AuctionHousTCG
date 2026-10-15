// Package kyc derives a buyer's verification tier from the four
// independent nullable timestamps on users (phone_verified_at,
// email_verified_at, identity_verified_at, bank_verified_at) — never a
// stored, mutable level column, the same "derive from history" principle
// CLAUDE.md §5.4 already applies to seller tier and account suspensions.
//
// L1 requires BOTH phone AND email verification — the achievable floor,
// not plain signup itself. Explicit product decision: Supabase's/Google's
// own signup email confirmation (a link click) doesn't count as this
// factor — email_verified_at is only ever set by internal/emailverify's
// own typed one-time code, mirroring the phone flow's "prove you can act
// on this inbox/number right now" shape rather than a weaker one-time
// link click. Email-only or phone-only accounts are both trivially
// recreated (a new inbox, a cheap secondary SIM) — requiring both raises
// the bar for the ban-evasion path this ladder exists to close, without
// pretending either signal alone is sufficient. L2 (Stripe Identity:
// government ID + SSN, verified by Stripe, never stored by us) removes
// the purchase cap entirely. L3 (a verified, linked bank account) doesn't
// raise the cap further — L2 already "lets you buy anything," per product
// decision — it instead unlocks the ACH payment rail, because an ACH
// debit is structurally much harder to reverse than a card chargeback,
// the actual problem this whole system exists to solve.
package kyc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrPurchaseNotAllowed/ErrExceedsPurchaseCap are CheckPurchase's two
// distinct failure cases — kept separate (rather than one generic error)
// so callers can show "verify your phone number" vs. "this exceeds your
// current limit," which need genuinely different calls to action.
var (
	ErrPurchaseNotAllowed = errors.New("verify your phone number and email before bidding or buying")
	ErrExceedsPurchaseCap = errors.New("this exceeds what your current verification level allows — verify your identity to remove the cap")
)

// querier is satisfied by both *pgxpool.Pool and pgx.Tx — LevelForUser is
// called both standalone (checkout-intent creation, not yet in a
// transaction) and from inside auction.attemptBid's own bid-placement
// transaction, so it must work against either without the caller needing
// to open a second connection mid-transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const (
	LevelNone     = 0
	LevelPhone    = 1
	LevelIdentity = 2
	LevelBank     = 3
)

// Level returns 0-3 from which verification timestamps are set. L1
// requires BOTH phoneVerifiedAt and emailVerifiedAt — missing either one
// stays at L0, since the whole point of requiring both is that neither
// alone is a strong enough signal on its own. A user with bank_verified_at
// set but not identity_verified_at still can't skip to L3 — each tier
// requires the ones below it, since L2 (ID+SSN) is what actually removes
// the purchase cap and L3 is additive on top of that.
func Level(phoneVerifiedAt, emailVerifiedAt, identityVerifiedAt, bankVerifiedAt *time.Time) int {
	if phoneVerifiedAt == nil || emailVerifiedAt == nil {
		return LevelNone
	}
	if identityVerifiedAt == nil {
		return LevelPhone
	}
	if bankVerifiedAt == nil {
		return LevelIdentity
	}
	return LevelBank
}

// MaxPurchaseCents returns the per-item cap for a level, or nil for "no
// cap". Level 0 can't purchase at all (a 0-cent cap, not nil) — phone
// verification is the floor, not an optional upgrade.
func MaxPurchaseCents(level int) *int64 {
	switch level {
	case LevelNone:
		zero := int64(0)
		return &zero
	case LevelPhone:
		cap := int64(7500)
		return &cap
	default:
		return nil
	}
}

// LevelForUser reads the three verification timestamps directly (rather
// than going through internal/user, which would be a needless extra join
// of profile/canvas data every enforcement check doesn't need) and derives
// the level. Called at bid/buy time, never cached — CLAUDE.md §5.4's
// "derive on read" principle applies here exactly as it does to seller
// tier, so verifying phone/identity/bank takes effect on the very next
// bid/buy attempt, no staleness window.
func LevelForUser(ctx context.Context, db querier, userID string) (int, error) {
	var phoneVerifiedAt, emailVerifiedAt, identityVerifiedAt, bankVerifiedAt *time.Time
	err := db.QueryRow(ctx,
		`select phone_verified_at, email_verified_at, identity_verified_at, bank_verified_at from users where id = $1`, userID,
	).Scan(&phoneVerifiedAt, &emailVerifiedAt, &identityVerifiedAt, &bankVerifiedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LevelNone, nil
		}
		return 0, fmt.Errorf("query kyc level: %w", err)
	}
	return Level(phoneVerifiedAt, emailVerifiedAt, identityVerifiedAt, bankVerifiedAt), nil
}

// Enforce gates whether CheckPurchase enforces anything at all — set from
// cmd/api/main.go to whether phone verification (internal/phoneverify) is
// actually configured. Same graceful-degradation shape as every other
// optional integration in this codebase (CLAUDE.md §6.12 etc.): if Twilio
// isn't configured, no user can ever reach level 1, so enforcing a $0/$75
// cap would block every purchase on the site rather than just the ones
// this system is meant to catch. Defaults false so a bare `go test`/local
// dev without TWILIO_* env vars never bricks bidding/buying.
var Enforce = false

// CheckPurchase is the one call site every bid/buy path uses to enforce
// MaxPurchaseCents against an actual price — level 0 fails with
// ErrPurchaseNotAllowed regardless of price (a $0 cap), a price over
// level 1's cap fails with ErrExceedsPurchaseCap, and level 2+ always
// passes. Always nil (a no-op) when Enforce is false.
func CheckPurchase(level int, priceCents int64) error {
	if !Enforce {
		return nil
	}
	cap := MaxPurchaseCents(level)
	if cap == nil {
		return nil
	}
	if *cap == 0 {
		return ErrPurchaseNotAllowed
	}
	if priceCents > *cap {
		return ErrExceedsPurchaseCap
	}
	return nil
}
