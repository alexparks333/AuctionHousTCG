-- Self-serve account deletion (internal/user.DeleteAccount). The users row
-- is never actually deleted — orders, reviews, claims, payouts and messages
-- all reference it, and those records have to survive for the other party,
-- for tax, and for chargeback/dispute defence. Instead the row is scrubbed
-- of personal data and stamped with deleted_at, and the Supabase Auth login
-- is deleted so the account can't be signed into again.
alter table users add column deleted_at timestamptz;
