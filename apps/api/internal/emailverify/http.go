package emailverify

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/platform"
)

// HandleStartVerify reads the caller's own email off their users row
// (never a client-supplied value — there is exactly one email this could
// ever mean: the one the account is already registered with) and mails a
// fresh code to it.
func HandleStartVerify(pool *pgxpool.Pool, mailClient *mail.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var email string
		if err := pool.QueryRow(r.Context(), `select email from users where id = $1`, userID).Scan(&email); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := StartVerification(r.Context(), pool, mailClient, userID, email); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type checkRequest struct {
	Code string `json:"code"`
}

// HandleCheckVerify is the only place email_verified_at is ever set —
// derived-from-history KYC level 1 (internal/kyc.Level) requires this
// alongside phone_verified_at, and takes effect on this user's very next
// bid/buy attempt the instant this commits.
func HandleCheckVerify(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req checkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
			http.Error(w, "a code is required", http.StatusBadRequest)
			return
		}
		if err := CheckVerification(r.Context(), pool, userID, req.Code); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrCodeNotApproved) {
				status = http.StatusBadRequest
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
