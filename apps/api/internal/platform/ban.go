package platform

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WithBanGuard blocks every mutating request (anything but GET/HEAD/
// OPTIONS) from a user with a live chargeback-fraud ban, before it ever
// reaches the mux's routing — one choke point instead of editing every
// individual route registration in cmd/api/main.go, the same reasoning
// that made WithCORS (cors.go) a single wrap-the-whole-mux layer rather
// than per-route middleware.
//
// A ban is a permanent (ends_at = 'infinity') account_suspensions row with
// reason 'chargeback_fraud' ("any chargeback filed at all" —
// internal/chargeback.RecordCreated) or 'ban_evasion' (internal/webhook's
// identity-fingerprint reuse check, internal/phoneverify's phone-number
// reuse check — internal/accountban.ReasonBanEvasion) — deliberately the
// same table Plan A's ship-deadline suspension uses, with different reason
// values, so this is one more read against an existing shape, not a new
// concept. Both reasons are enforced identically here; they're kept
// distinct only so the audit trail can still tell "filed a real dispute"
// apart from "detected reusing a banned account's own signal."
//
// GET requests always pass through untouched — this is what keeps "can
// still log in and view your own account" true for free: every read stays
// reachable, only writes (bid, buy, sell, message, offer, review, ...) are
// blocked. A request with no valid token also passes through untouched —
// rejecting unauthenticated requests is RequireAuth's job, not this
// guard's; this guard only ever adds a 403 on top of an otherwise-valid,
// identified, banned caller.
func WithBanGuard(pool *pgxpool.Pool, verifier *AuthVerifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		userID, ok := verifier.userIDFromRequest(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}

		// deleted also covers a deleted account whose login token hasn't
		// expired yet (internal/user.DeleteAccount) — it can't change
		// anything in the short window before the token runs out.
		var banned, deleted bool
		err := pool.QueryRow(r.Context(),
			`select
				exists(
					select 1 from account_suspensions
					where user_id = $1 and reason in ('chargeback_fraud', 'ban_evasion') and now() < ends_at
				),
				exists(select 1 from users where id = $1 and deleted_at is not null)`, userID,
		).Scan(&banned, &deleted)
		if err != nil {
			// Fail open on a DB error here — this guard is a fraud
			// deterrent layered on top of normal request handling, not
			// the request handling itself; a transient DB hiccup should
			// never turn into every mutating endpoint on the site 500ing.
			next.ServeHTTP(w, r)
			return
		}
		if deleted && !strings.HasSuffix(r.URL.Path, "/me/delete-account") {
			http.Error(w, "this account has been deleted", http.StatusForbidden)
			return
		}
		if banned {
			http.Error(w, "this account is permanently banned for violating our chargeback and account-integrity policies", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
