package singles

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/cardcatalog"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrGameNotEnabled), errors.Is(err, ErrCardNotFound), errors.Is(err, ErrNotEligible), errors.Is(err, ErrNoMarketPrice):
		status = http.StatusBadRequest
	}
	http.Error(w, err.Error(), status)
}

// HandleListMine backs GET /me/singles — the seller's own Singles Shop
// management view, sold-out rows included so they can be restocked.
func HandleListMine(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		list, err := ListForSeller(r.Context(), pool, userID, false)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// HandleListForUser backs GET /users/{username}/singles — public, the
// in-stock singles a buyer can see on a seller's profile.
func HandleListForUser(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		list, err := ListForSeller(r.Context(), pool, u.ID, true)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// HandleAdd backs POST /me/singles. cards is nil when the TCG Haven
// catalog isn't configured — the shop can't be stocked without it, since
// every single is a catalog card.
func HandleAdd(pool *pgxpool.Pool, cards *cardcatalog.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if cards == nil {
			http.Error(w, "card catalog isn't configured", http.StatusServiceUnavailable)
			return
		}
		if err := user.RequireUsername(r.Context(), pool, userID); err != nil {
			http.Error(w, "set a username before stocking your Singles Shop", http.StatusForbidden)
			return
		}
		var in AddInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		s, err := Add(r.Context(), pool, cards, userID, in)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, s)
	}
}

// HandleUpdate backs PATCH /me/singles/{id} — quantity only.
func HandleUpdate(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var in UpdateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		s, err := Update(r.Context(), pool, userID, r.PathValue("id"), in)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, s)
	}
}

// HandleRemove backs DELETE /me/singles/{id}.
func HandleRemove(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := Remove(r.Context(), pool, userID, r.PathValue("id")); err != nil {
			writeErr(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
