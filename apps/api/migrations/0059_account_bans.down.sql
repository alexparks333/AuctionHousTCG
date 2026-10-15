alter table users
    drop column bank_verified_at,
    drop column identity_verified_at,
    drop column stripe_identity_session_id,
    drop column phone_verified_at,
    drop column phone_number;

drop index if exists orders_buyer_payment_fingerprint_idx;
alter table orders
    drop column buyer_payment_fingerprint,
    drop column fraud_policy_version,
    drop column fraud_ack_at;

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in (
        'won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review',
        'offer_received', 'offer_accepted', 'offer_declined',
        'second_chance_offer', 'listing_needs_relist', 'chargeback_lost',
        'ship_deadline_warning', 'account_suspended', 'ship_extension_granted'
    ));

alter table account_suspensions drop constraint account_suspensions_reason_check;
alter table account_suspensions add constraint account_suspensions_reason_check
    check (reason in ('missed_ship_deadline'));
