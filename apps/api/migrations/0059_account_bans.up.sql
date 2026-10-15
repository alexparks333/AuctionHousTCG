-- Chargeback-fraud account bans, a checkout-time fraud acknowledgment, a
-- payment-fingerprint ban-evasion check, and a 3-level KYC ladder gating
-- purchase size.

-- The ban is a new reason on the same account_suspensions table Plan A
-- built for ship-deadline strikes (migration 0058) — 'infinity' is
-- Postgres's own timestamp literal, permanently greater than now(), so the
-- existing `now() < ends_at` check everywhere needs zero changes to also
-- mean "permanent" for this reason.
alter table account_suspensions drop constraint account_suspensions_reason_check;
alter table account_suspensions add constraint account_suspensions_reason_check
    check (reason in ('missed_ship_deadline', 'chargeback_fraud'));

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in (
        'won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review',
        'offer_received', 'offer_accepted', 'offer_declined',
        'second_chance_offer', 'listing_needs_relist', 'chargeback_lost',
        'ship_deadline_warning', 'account_suspended', 'ship_extension_granted',
        'account_banned'
    ));

-- fraud_ack_at/fraud_policy_version record the checkout-time acknowledgment
-- ("if you chargeback instead of filing a claim, you will be banned");
-- buyer_payment_fingerprint is Stripe's own stable card/bank-account
-- fingerprint, captured at capture time, checked against past orders tied
-- to a banned account before/after future charges.
alter table orders
    add column fraud_ack_at timestamptz,
    add column fraud_policy_version smallint,
    add column buyer_payment_fingerprint text;
create index orders_buyer_payment_fingerprint_idx on orders (buyer_payment_fingerprint)
    where buyer_payment_fingerprint is not null;

-- The 3-level KYC ladder — a level is always derived from which of these
-- three are set (internal/kyc.Level), never stored as its own mutable
-- column, same "derive from history" principle as seller tier and
-- account_suspensions itself. identity_verification records only Stripe
-- Identity's own session id and outcome — never an SSN or ID document,
-- which never touches this backend at all.
alter table users
    add column phone_number text,
    add column phone_verified_at timestamptz,
    add column stripe_identity_session_id text,
    add column identity_verified_at timestamptz,
    add column bank_verified_at timestamptz;
