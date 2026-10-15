-- Closes a real gap in Plan B: KYC as originally built proved "this is a
-- real, distinct-feeling account" but stored nothing that let us tell if
-- the SAME person (phone number, or verified government ID) was already
-- banned under a different account. 'ban_evasion' is a new, separate
-- account_suspensions reason from 'chargeback_fraud' — same permanent
-- (ends_at = 'infinity') enforcement via the existing WithBanGuard
-- middleware, but a distinct audit trail: chargeback_fraud means a real
-- dispute was filed; ban_evasion means this account was detected reusing
-- a signal (phone number, or verified identity) tied to an account
-- already banned for either reason.
alter table account_suspensions drop constraint account_suspensions_reason_check;
alter table account_suspensions add constraint account_suspensions_reason_check
    check (reason in ('missed_ship_deadline', 'chargeback_fraud', 'ban_evasion'));

-- identity_fingerprint_hash is an HMAC-SHA256 (never a plain hash — SSNs
-- are only 9 digits, low enough entropy that a plain hash is brute-forceable
-- offline from a leaked table; HMAC with a server-side-only secret key
-- makes that infeasible) over the verified ID number + date of birth
-- Stripe Identity's own VerifiedOutputs returns — never the raw SSN or ID
-- document itself, which never touches this column or any other.
alter table users add column identity_fingerprint_hash text;
create index users_identity_fingerprint_hash_idx on users (identity_fingerprint_hash)
    where identity_fingerprint_hash is not null;
