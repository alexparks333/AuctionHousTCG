// Package emailverify is KYC level 1's email half (Plan B / CLAUDE.md §7's
// chargeback-fraud ban system — level 1 now requires BOTH phone AND email
// verification, an explicit product decision) — a one-time 6-digit code
// mailed to the account's own email address, deliberately not Supabase's/
// Google's own signup email confirmation (a link click, which the product
// owner considered too weak a signal to double as this system's own
// factor — this is a typed code, the same "prove you can act on this
// inbox right now" shape internal/phoneverify already uses for SMS).
//
// One pending code per user (users.email_verification_code/_sent_at) —
// starting a new verification always overwrites any still-outstanding
// one, same "no separate table needed for 1:1 state" reasoning as
// phone_number/phone_verified_at (migration 0059) and this migration's
// own doc comment (0060).
package emailverify

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/mail"
)

// codeValidFor is deliberately more generous than a typical SMS OTP
// window (internal/phoneverify defers that timing entirely to Twilio) —
// email delivery is slower and less predictable than SMS, so a tight
// window would produce more false "expired" failures for no real
// security benefit at this threat level.
const codeValidFor = 15 * time.Minute

var (
	// ErrNotConfigured mirrors phoneverify.Client's own nil-safety — a
	// caller with an unconfigured *mail.Client gets a clear error instead
	// of a nil-pointer panic.
	ErrNotConfigured = errors.New("email verification is not configured")
	// ErrCodeNotApproved covers a wrong code, an expired one, or no code
	// ever having been sent — CheckVerification doesn't distinguish
	// further, same "the caller's UI only needs one message" reasoning as
	// phoneverify.ErrCodeNotApproved.
	ErrCodeNotApproved = errors.New("verification code is incorrect or expired")
)

// StartVerification generates a fresh 6-digit code, stores it against
// userID (overwriting any prior still-outstanding code), and mails it to
// email — the account's own address, already known and unverified-or-not
// on the users row, never a value the caller supplies (see http.go's
// HandleStartVerify, which reads it server-side rather than trusting a
// request body).
func StartVerification(ctx context.Context, pool *pgxpool.Pool, mailClient *mail.Client, userID, email string) error {
	if !mailClient.IsConfigured() {
		return ErrNotConfigured
	}
	code, err := randomCode()
	if err != nil {
		return fmt.Errorf("generate verification code: %w", err)
	}
	if _, err := pool.Exec(ctx, `
		update users set email_verification_code = $1, email_verification_sent_at = now() where id = $2
	`, code, userID); err != nil {
		return fmt.Errorf("store verification code: %w", err)
	}

	subject := "Your AuctionHous verification code"
	html := fmt.Sprintf(`
		<p>Your AuctionHous verification code is:</p>
		<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">%s</p>
		<p>This code expires in %d minutes. If you didn't request this, you can ignore this email.</p>
	`, code, int(codeValidFor.Minutes()))
	if err := mailClient.SendTo(ctx, email, subject, html); err != nil {
		return fmt.Errorf("send verification email: %w", err)
	}
	return nil
}

// CheckVerification validates code against whatever StartVerification most
// recently stored for userID — nil only when it matches AND hasn't
// expired, in which case email_verified_at is stamped and the pending
// code is cleared (a used or superseded code can never be replayed).
func CheckVerification(ctx context.Context, pool *pgxpool.Pool, userID, code string) error {
	var storedCode *string
	var sentAt *time.Time
	if err := pool.QueryRow(ctx, `
		select email_verification_code, email_verification_sent_at from users where id = $1
	`, userID).Scan(&storedCode, &sentAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCodeNotApproved
		}
		return fmt.Errorf("query verification code: %w", err)
	}
	if storedCode == nil || sentAt == nil || *storedCode != code || time.Since(*sentAt) > codeValidFor {
		return ErrCodeNotApproved
	}
	if _, err := pool.Exec(ctx, `
		update users set email_verified_at = now(), email_verification_code = null, email_verification_sent_at = null
		where id = $1
	`, userID); err != nil {
		return fmt.Errorf("record email verified: %w", err)
	}
	return nil
}

// randomCode returns a cryptographically random 6-digit string
// ("000000"-"999999") — crypto/rand, not math/rand, for the same reason
// any other one-time code in this app would need it: predictability here
// is a real account-takeover/ban-evasion vector, not just a style nit.
func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
