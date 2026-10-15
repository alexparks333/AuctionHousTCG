// Package user owns the public-facing identity concept shown wherever a
// seller/buyer is displayed to someone else — a chosen username, not their
// email (CLAUDE.md's account-creation section covers the auth pipeline
// this builds on). email stays real and returned by Get/HandleMe; it's
// just no longer shown to other users anywhere in the frontend.
package user

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

var (
	ErrNotFound        = errors.New("user not found")
	ErrInvalidUsername = errors.New("username must be 3-20 characters, letters/numbers/underscore only")
	ErrUsernameTaken   = errors.New("username is already taken")
	ErrNoUsername      = errors.New("you must set a username before doing this")
	ErrInvalidBio      = errors.New("bio must be 500 characters or fewer")
)

const maxBioLength = 500

// User is both the domain model and the /me JSON shape — includes Email,
// which is why this type must never be serialized directly from a public
// (non-"me") endpoint. Username and Bio are nullable — a fresh Google
// OAuth sign-in has no username until they complete the claim-username
// flow (apps/api/migrations/0008_usernames.up.sql), and a bio is optional.
type User struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Username  *string `json:"username"`
	Bio       *string `json:"bio"`
	CreatedAt string  `json:"createdAt"`
	// Tier is design doc v2 §3's trust tier (internal/seller.Tier) —
	// 'new' for every seller until they've completed enough orders to
	// promote (internal/seller.RecomputeTier). Included on the plain User
	// shape, not gated behind a separate seller-only endpoint, since a
	// tier badge is meant to be publicly visible on a seller's profile
	// (design doc v2 §2.7: "publish the full tier ladder openly").
	Tier string `json:"tier"`
	// IsBanned/BannedAt are derived, never stored, from a live
	// account_suspensions row (reason 'chargeback_fraud' or 'ban_evasion',
	// ends_at = 'infinity') — same "derive from history" shape as Tier.
	// Included on PublicUser too (see below) since the ban banner must render on a
	// banned seller's public profile for other viewers, not just /me.
	IsBanned bool    `json:"isBanned"`
	BannedAt *string `json:"bannedAt"`
	// PhoneVerifiedAt/EmailVerifiedAt/IdentityVerifiedAt/BankVerifiedAt back
	// internal/kyc.Level — never on PublicUser, this is nobody else's
	// business. EmailVerifiedAt is internal/emailverify's own one-time-code
	// flow, not Supabase's/Google's signup email confirmation — see
	// internal/kyc's package doc for why those don't count as this factor.
	PhoneVerifiedAt    *string `json:"phoneVerifiedAt"`
	EmailVerifiedAt    *string `json:"emailVerifiedAt"`
	IdentityVerifiedAt *string `json:"identityVerifiedAt"`
	BankVerifiedAt     *string `json:"bankVerifiedAt"`
}

// PublicUser is what a seller's public profile page shows other users —
// deliberately excludes Email, the entire point of the username feature
// this builds on. Tier is intentionally still included — see User.Tier.
// IsBanned/BannedAt are included too: a dead, banned account should read as banned to anyone viewing
// its profile, not just to the banned user themselves.
type PublicUser struct {
	ID        string  `json:"id"`
	Username  *string `json:"username"`
	Bio       *string `json:"bio"`
	CreatedAt string  `json:"createdAt"`
	Tier      string  `json:"tier"`
	IsBanned  bool    `json:"isBanned"`
	BannedAt  *string `json:"bannedAt"`
}

func (u *User) ToPublic() *PublicUser {
	return &PublicUser{
		ID: u.ID, Username: u.Username, Bio: u.Bio, CreatedAt: u.CreatedAt, Tier: u.Tier,
		IsBanned: u.IsBanned, BannedAt: u.BannedAt,
	}
}

// banStatusColumns is shared by Get/GetByUsername — a live subquery against
// account_suspensions, never a stored flag, so a ban (or, hypothetically, a
// direct DB-level unban) is reflected immediately with no cache to bust.
const banStatusColumns = `
		exists(
			select 1 from account_suspensions s
			where s.user_id = users.id and s.reason in ('chargeback_fraud', 'ban_evasion') and now() < s.ends_at
		) as is_banned,
		(
			select s.starts_at from account_suspensions s
			where s.user_id = users.id and s.reason in ('chargeback_fraud', 'ban_evasion') and now() < s.ends_at
			order by s.starts_at desc limit 1
		) as banned_at`

func Get(ctx context.Context, pool *pgxpool.Pool, id string) (*User, error) {
	var u User
	var createdAt time.Time
	var bannedAt, phoneVerifiedAt, emailVerifiedAt, identityVerifiedAt, bankVerifiedAt *time.Time
	err := pool.QueryRow(ctx,
		`select id, email, username, bio, created_at, tier,
			phone_verified_at, email_verified_at, identity_verified_at, bank_verified_at,`+banStatusColumns+`
		from users where id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.Username, &u.Bio, &createdAt, &u.Tier,
		&phoneVerifiedAt, &emailVerifiedAt, &identityVerifiedAt, &bankVerifiedAt, &u.IsBanned, &bannedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query user: %w", err)
	}
	u.CreatedAt = createdAt.Format(time.RFC3339)
	u.BannedAt = formatNullableTime(bannedAt)
	u.PhoneVerifiedAt = formatNullableTime(phoneVerifiedAt)
	u.EmailVerifiedAt = formatNullableTime(emailVerifiedAt)
	u.IdentityVerifiedAt = formatNullableTime(identityVerifiedAt)
	u.BankVerifiedAt = formatNullableTime(bankVerifiedAt)
	return &u, nil
}

// GetByUsername resolves a public username to the full user row — used
// both to render a seller's public profile (via ToPublic) and internally
// by internal/feedback to resolve a seller's id from the username in a
// review endpoint's URL.
func GetByUsername(ctx context.Context, pool *pgxpool.Pool, username string) (*User, error) {
	var u User
	var createdAt time.Time
	var bannedAt, phoneVerifiedAt, emailVerifiedAt, identityVerifiedAt, bankVerifiedAt *time.Time
	err := pool.QueryRow(ctx,
		`select id, email, username, bio, created_at, tier,
			phone_verified_at, email_verified_at, identity_verified_at, bank_verified_at,`+banStatusColumns+`
		from users where lower(username) = lower($1)`, username,
	).Scan(&u.ID, &u.Email, &u.Username, &u.Bio, &createdAt, &u.Tier,
		&phoneVerifiedAt, &emailVerifiedAt, &identityVerifiedAt, &bankVerifiedAt, &u.IsBanned, &bannedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query user by username: %w", err)
	}
	u.CreatedAt = createdAt.Format(time.RFC3339)
	u.BannedAt = formatNullableTime(bannedAt)
	u.PhoneVerifiedAt = formatNullableTime(phoneVerifiedAt)
	u.EmailVerifiedAt = formatNullableTime(emailVerifiedAt)
	u.IdentityVerifiedAt = formatNullableTime(identityVerifiedAt)
	u.BankVerifiedAt = formatNullableTime(bankVerifiedAt)
	return &u, nil
}

func formatNullableTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// ValidateUsername is the single source of truth for the format rule on
// the Go side — SetUsername and IsUsernameAvailable both call this so the
// two never drift from each other or from the DB's own check constraint.
func ValidateUsername(username string) error {
	if !usernameRe.MatchString(username) {
		return ErrInvalidUsername
	}
	return nil
}

// SetUsername claims or changes userID's username — the same call backs
// both the first-time claim flow and later edits from Account Settings,
// since the semantics (validate, attempt update, 409 on collision) don't
// differ by which screen called it. ErrUsernameTaken is the
// defense-in-depth path for when IsUsernameAvailable's earlier check has
// gone stale by submit time (another user claimed it in between).
func SetUsername(ctx context.Context, pool *pgxpool.Pool, userID, username string) (*User, error) {
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	_, err := pool.Exec(ctx, `update users set username = $1 where id = $2`, username, userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrUsernameTaken
		}
		return nil, fmt.Errorf("update username: %w", err)
	}
	return Get(ctx, pool, userID)
}

// IsUsernameAvailable backs the public GET /usernames/available endpoint.
// Format-invalid input reports as unavailable rather than a separate
// error, so the frontend's debounce hook only ever needs one boolean.
func IsUsernameAvailable(ctx context.Context, pool *pgxpool.Pool, username string) (bool, error) {
	if err := ValidateUsername(username); err != nil {
		return false, nil
	}
	var exists bool
	err := pool.QueryRow(ctx,
		`select exists(select 1 from users where lower(username) = lower($1))`, username,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check username availability: %w", err)
	}
	return !exists, nil
}

// SetBio updates userID's bio. An empty string clears it (stored as NULL,
// not ""), so the profile page can tell "no bio written" apart from
// "wrote an empty string" without a separate flag.
func SetBio(ctx context.Context, pool *pgxpool.Pool, userID, bio string) (*User, error) {
	if len(bio) > maxBioLength {
		return nil, ErrInvalidBio
	}
	var bioArg *string
	if bio != "" {
		bioArg = &bio
	}
	if _, err := pool.Exec(ctx, `update users set bio = $1 where id = $2`, bioArg, userID); err != nil {
		return nil, fmt.Errorf("update bio: %w", err)
	}
	return Get(ctx, pool, userID)
}

// RequireUsername is called by listing.Create to enforce "you must have a
// username before creating public-facing content" — the one place today
// that resolves a user's identity to a display string for other people to
// see (CLAUDE.md: bidder identity is never resolved to text, only an id).
func RequireUsername(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	u, err := Get(ctx, pool, userID)
	if err != nil {
		return err
	}
	if u.Username == nil {
		return ErrNoUsername
	}
	return nil
}

// IsAdmin checks callerID's email against a comma-separated allowlist
// (platform.Config.AdminEmails) — the minimal, no-real-admin-app stand-in
// shared by internal/dispute's human-review routes and internal/metrics'
// reporting page. Empty adminEmails means nobody is an admin, not that
// everybody is.
func IsAdmin(ctx context.Context, pool *pgxpool.Pool, adminEmails, callerID string) bool {
	if adminEmails == "" {
		return false
	}
	u, err := Get(ctx, pool, callerID)
	if err != nil {
		return false
	}
	for _, allowed := range strings.Split(adminEmails, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), u.Email) {
			return true
		}
	}
	return false
}
