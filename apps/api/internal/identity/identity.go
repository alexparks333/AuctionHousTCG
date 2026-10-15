// Package identity is the thin HTTP layer over
// internal/payment.Client.CreateIdentityVerificationSession — KYC level 2
// (Plan B / CLAUDE.md §7's chargeback-fraud ban system). The actual
// verified/failed outcome is recorded by internal/webhook's
// identity.verification_session.verified case, not here — this package
// only ever starts a session and hands the buyer the hosted-flow URL to
// redirect to.
package identity

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

type startResponse struct {
	URL string `json:"url"`
}

// HandleStart creates a new Stripe Identity VerificationSession for the
// caller and stores its id immediately (stripe_identity_session_id) — not
// yet identity_verified_at, which only the webhook sets once Stripe
// actually confirms the check passed.
func HandleStart(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !paymentClient.IsConfigured() {
			http.Error(w, "identity verification is not configured", http.StatusServiceUnavailable)
			return
		}
		vs, err := paymentClient.CreateIdentityVerificationSession(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if _, err := pool.Exec(r.Context(), `
			update users set stripe_identity_session_id = $1 where id = $2
		`, vs.ID, userID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(startResponse{URL: vs.URL})
	}
}
