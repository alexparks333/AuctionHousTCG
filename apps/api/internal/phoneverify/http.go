package phoneverify

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/accountban"
	"auctionhous-tcg/api/internal/platform"
)

type startRequest struct {
	// PhoneE164 is whatever the frontend's phone input has — NormalizeE164
	// (phoneverify.go) turns a plain 10-digit US number into real E.164
	// before it ever reaches Twilio or gets stored, a real, live-found gap
	// (a bare "Phone number" field with no format hint enforced is exactly
	// what produces "8188078706" instead of "+18188078706").
	PhoneE164 string `json:"phone"`
}

// HandleStartVerify sends the SMS code and, on success, stashes phoneE164
// on the user row immediately (not waiting for the code to be confirmed)
// — phone_number is just contact info at this point, distinct from
// phone_verified_at, which only CheckVerify below ever sets. Storing it
// early means a user who abandons the flow mid-code-entry and comes back
// later doesn't have to retype their number.
func HandleStartVerify(pool *pgxpool.Pool, client *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req startRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PhoneE164 == "" {
			http.Error(w, "a phone number is required", http.StatusBadRequest)
			return
		}
		if err := client.StartVerification(r.Context(), req.PhoneE164); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if _, err := pool.Exec(r.Context(), `update users set phone_number = $1 where id = $2`, NormalizeE164(req.PhoneE164), userID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type checkRequest struct {
	PhoneE164 string `json:"phone"`
	Code      string `json:"code"`
}

// HandleCheckVerify is the only place phone_verified_at is ever set —
// derived-from-history KYC level 1 (internal/kyc.Level) becomes true for
// this user's very next bid/buy attempt the instant this commits, no
// caching or staleness window.
func HandleCheckVerify(pool *pgxpool.Pool, client *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req checkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PhoneE164 == "" || req.Code == "" {
			http.Error(w, "a phone number and code are required", http.StatusBadRequest)
			return
		}
		if err := client.CheckVerification(r.Context(), req.PhoneE164, req.Code); err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, ErrCodeNotApproved) {
				status = http.StatusBadRequest
			}
			http.Error(w, err.Error(), status)
			return
		}
		normalized := NormalizeE164(req.PhoneE164)
		if _, err := pool.Exec(r.Context(), `
			update users set phone_number = $1, phone_verified_at = now() where id = $2
		`, normalized, userID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		checkPhoneReuse(r.Context(), pool, userID, normalized)
		w.WriteHeader(http.StatusNoContent)
	}
}

// checkPhoneReuse is the phone half of ban-evasion detection (the identity
// half lives in internal/webhook.recordIdentityVerified) — a banned user
// re-verifying the SAME phone number on a brand-new account is exactly the
// laziest evasion path, and unlike identity verification this needs no
// external service or secret key to catch: two accounts sharing a real,
// Twilio-verified phone number is itself the signal. Best-effort/logged,
// not returned as an error: the phone verification itself already
// succeeded and committed by the time this runs.
func checkPhoneReuse(ctx context.Context, pool *pgxpool.Pool, userID, normalizedPhone string) {
	var matchesBannedAccount bool
	if err := pool.QueryRow(ctx, `
		select exists(
			select 1 from users u
			join account_suspensions s on s.user_id = u.id
			where u.phone_number = $1 and u.id != $2 and now() < s.ends_at
		)
	`, normalizedPhone, userID).Scan(&matchesBannedAccount); err != nil {
		log.Printf("phoneverify: failed to check phone number reuse for %s: %v", userID, err)
		return
	}
	if !matchesBannedAccount {
		return
	}
	banned, err := accountban.Ban(ctx, pool, userID, accountban.ReasonBanEvasion)
	if err != nil {
		log.Printf("phoneverify: failed to ban %s for phone-number reuse: %v", userID, err)
	} else if banned {
		log.Printf("phoneverify: banned user %s — phone number matches an already-banned account", userID)
	}
}
