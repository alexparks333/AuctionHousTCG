-- KYC level 1 now requires BOTH phone AND email verification (explicit
-- product decision, revising 0059's original phone-only level 1) — a code
-- sent to the account's own email address, not Supabase's/Google's own
-- signup confirmation, which the product owner considered too weak a
-- signal on its own for this purpose (a magic-link click, not a typed
-- code). email_verification_code/email_verification_sent_at are a single
-- pending-code slot per user (only one code can be outstanding at a time,
-- same "no separate table needed for 1:1 state" reasoning as
-- phone_number/phone_verified_at) — cleared once verified.
alter table users
    add column email_verification_code text,
    add column email_verification_sent_at timestamptz,
    add column email_verified_at timestamptz;
