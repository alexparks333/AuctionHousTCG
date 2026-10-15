-- Order-lifecycle failure handling: second-chance offers for buyer-fault
-- failures (never paid, or a chargeback lost before the item shipped),
-- seller-fault ship-deadline strikes/suspension (no second-chance —
-- relisting the same unreliable seller's item doesn't fix anything), a
-- one-time paid shipping extension, and a new claims reason code for
-- "shipped but tracking never updated" so that case goes through real
-- evidence review instead of a blind timer-driven refund.

-- ship_deadline replaces the implicit "updated_at + fixed interval" the
-- worker used to compute inline — an explicit column is what lets
-- RequestShipExtension actually move the deadline out. Stamped by
-- internal/order.Transition itself (not each of its three call sites)
-- whenever an order lands in awaiting_ship, so no call site can forget it.
alter table orders
    add column ship_deadline timestamptz,
    add column ship_extension_used_at timestamptz;

-- A listing sells at most once *live* — not "at most once, ever" the way
-- the original plain unique index enforced (its own comment said as much).
-- A second-chance cycle after the original order dies unpaid/unshipped is
-- now a legitimate second sale for the same listing; voided_at marks the
-- old order_items row dead so a fresh one can be inserted. The real
-- double-sell protection was always the listings/auctions ownership
-- compare-and-swap, per that same original comment — this index is
-- belt-and-suspenders, and narrowing it doesn't change that.
alter table order_items add column voided_at timestamptz;
drop index order_items_listing_id_idx;
create unique index order_items_listing_id_live_idx on order_items (listing_id) where voided_at is null;

create table second_chance_offers (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references listings(id),
    seller_id uuid not null references users(id),
    bidder_id uuid not null references users(id),
    amount_cents bigint not null,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    responded_at timestamptz
);
create index second_chance_offers_listing_id_idx on second_chance_offers (listing_id);
create index second_chance_offers_bidder_id_idx on second_chance_offers (bidder_id);
-- At most one live offer per listing at a time.
create unique index second_chance_offers_listing_pending_idx on second_chance_offers (listing_id) where status = 'pending';

-- Generic on purpose (a reason column rather than a single-purpose table) —
-- "is this user currently suspended" is always a live query against this
-- table (now() < ends_at), never a mutable flag a job has to remember to
-- clear, same "derive from history" principle internal/seller's tier
-- already follows. missed_ship_deadline is the only reason built in this
-- pass; the column exists so a future reason doesn't need a new table.
create table account_suspensions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    reason text not null check (reason in ('missed_ship_deadline')),
    starts_at timestamptz not null default now(),
    ends_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index account_suspensions_user_id_idx on account_suspensions (user_id, ends_at);

-- One row per missed ship deadline — counted over a trailing 30-day window
-- to decide warning vs. suspension, never collapsed into a single counter
-- column so the history itself stays auditable.
create table seller_ship_strikes (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references users(id),
    order_id uuid not null references orders(id),
    created_at timestamptz not null default now()
);
create index seller_ship_strikes_seller_id_idx on seller_ship_strikes (seller_id, created_at);

alter table notifications add column second_chance_offer_id uuid references second_chance_offers(id);
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in (
        'won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review',
        'offer_received', 'offer_accepted', 'offer_declined',
        'second_chance_offer', 'listing_needs_relist', 'chargeback_lost',
        'ship_deadline_warning', 'account_suspended', 'ship_extension_granted'
    ));

alter table claims drop constraint claims_reason_code_check;
alter table claims add constraint claims_reason_code_check
    check (reason_code in (
        'not_as_described', 'not_received_no_tracking', 'not_received_tracking_delivered',
        'payment_fraud', 'buyers_remorse', 'transit_damage', 'not_received_tracking_stalled'
    ));
