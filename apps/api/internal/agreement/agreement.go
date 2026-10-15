// Package agreement records members' acceptance of the site's legal
// documents and enforces it:
//
//   - the Terms of Service (which incorporates the Privacy Policy), required
//     of everyone — platform.WithBanGuard refuses writes from anyone who
//     hasn't accepted TermsVersion;
//   - the Seller Agreement, required before selling — RequireSeller wraps
//     the routes that create listings, stock singles and start payouts.
//
// Each acceptance is a row in agreement_acceptances (user, document,
// version, time), so there's a record of exactly what someone agreed to and
// when. Email sign-ups record Terms acceptance in the signup trigger
// (migration 0065); everyone else accepts through POST /me/agreements.
package agreement

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// Current versions — the documents' effective dates. Bump one (here and in
// apps/web/lib/agreements.ts) whenever its page changes materially, and every
// member is asked to accept the new version on their next visit.
const (
	TermsVersion  = "2026-10-15"
	SellerVersion = "2026-10-15"
)

const (
	DocTerms  = "terms"
	DocSeller = "seller"
)

func currentVersion(document string) (string, bool) {
	switch document {
	case DocTerms:
		return TermsVersion, true
	case DocSeller:
		return SellerVersion, true
	}
	return "", false
}

// Status is which current documents the user has accepted.
type Status struct {
	Terms         bool   `json:"terms"`
	Seller        bool   `json:"seller"`
	TermsVersion  string `json:"termsVersion"`
	SellerVersion string `json:"sellerVersion"`
}

func GetStatus(ctx context.Context, pool *pgxpool.Pool, userID string) (Status, error) {
	s := Status{TermsVersion: TermsVersion, SellerVersion: SellerVersion}
	err := pool.QueryRow(ctx, `
		select
			exists(select 1 from agreement_acceptances where user_id = $1 and document = 'terms' and version = $2),
			exists(select 1 from agreement_acceptances where user_id = $1 and document = 'seller' and version = $3)`,
		userID, TermsVersion, SellerVersion,
	).Scan(&s.Terms, &s.Seller)
	if err != nil {
		return s, fmt.Errorf("agreement status: %w", err)
	}
	return s, nil
}

// Accept records acceptance of the current version of document. The version
// is always the server's own — a client can't claim to have accepted some
// other version.
func Accept(ctx context.Context, pool *pgxpool.Pool, userID, document string) error {
	version, ok := currentVersion(document)
	if !ok {
		return fmt.Errorf("unknown document %q", document)
	}
	_, err := pool.Exec(ctx, `
		insert into agreement_acceptances (user_id, document, version) values ($1, $2, $3)
		on conflict (user_id, document, version) do nothing`, userID, document, version)
	if err != nil {
		return fmt.Errorf("accept %s: %w", document, err)
	}
	return nil
}

// HandleStatus backs GET /me/agreements.
func HandleStatus(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := GetStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s)
	}
}

type acceptInput struct {
	Document string `json:"document"`
}

// HandleAccept backs POST /me/agreements {"document": "terms" | "seller"}.
func HandleAccept(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var in acceptInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if _, ok := currentVersion(in.Document); !ok {
			http.Error(w, "unknown document", http.StatusBadRequest)
			return
		}
		if err := Accept(r.Context(), pool, userID, in.Document); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		s, err := GetStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s)
	}
}

// RequireSeller refuses the wrapped (authenticated) handler until the caller
// has accepted the current Seller Agreement. Goes inside RequireAuth.
func RequireSeller(pool *pgxpool.Pool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := GetStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !s.Seller {
			http.Error(w, "accept the Seller Agreement before selling", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
