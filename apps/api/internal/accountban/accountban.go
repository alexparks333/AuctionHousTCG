// Package accountban is the shared "insert a permanent ban row" primitive
// behind two independent triggers: internal/chargeback's own inline
// banBuyer (a real chargeback was filed — reason 'chargeback_fraud', kept
// as its own unexported function there rather than migrated here, since
// it's already tested and working) and the two ban-evasion detectors this
// package backs directly — internal/webhook's identity-fingerprint reuse
// check and internal/phoneverify's phone-number reuse check (reason
// 'ban_evasion' for both: neither is itself a chargeback, both are "this
// account is reusing a signal tied to an already-banned one").
package accountban

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ReasonBanEvasion is the account_suspensions reason for both ban-evasion
// detectors — a distinct value from 'chargeback_fraud' so the two are
// still tellable apart in the audit trail (a real dispute filed, vs. this
// account was caught reusing a banned one's phone number or verified
// identity), even though enforcement (internal/platform.WithBanGuard,
// internal/user's derived IsBanned) treats every reason that isn't
// 'missed_ship_deadline' identically: banned, permanently, everywhere.
const ReasonBanEvasion = "ban_evasion"

// Ban permanently bans userID for reason (ends_at = 'infinity') —
// idempotent per (user, reason) pair, so calling it again for a user
// already banned under this exact reason is a harmless no-op. Returns
// true only if this call is the one that actually inserted the row (so
// callers can log/notify once, not on every redundant detection).
func Ban(ctx context.Context, pool *pgxpool.Pool, userID, reason string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		insert into account_suspensions (user_id, reason, ends_at)
		select $1, $2, 'infinity'
		where not exists (
			select 1 from account_suspensions where user_id = $1 and reason = $2
		)
	`, userID, reason)
	if err != nil {
		return false, fmt.Errorf("insert ban: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
