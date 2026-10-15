-- The Singles Shop (internal/singles): a seller's stock of standardized,
-- catalog-backed singles, sold by quantity alongside their photo listings.
-- Unlike a listing, a single has no seller photos at all — it's identified
-- purely by a TCG Haven catalog card (internal/cardcatalog), rendered with
-- that card's standard catalog image, plus a condition/foil variant, a
-- price, and a quantity on hand. Buyers add singles to an order at checkout
-- ("Add Singles To Your Order") rather than buying them standalone.
--
-- card_name/set_name/card_number/rarity/image_url are a snapshot of the
-- catalog card taken server-side at create time (never client-supplied),
-- so rendering a shop never needs a Firestore round trip and a later
-- catalog edit can't silently change what a past order says it contained.
create table shop_singles (
    id              uuid primary key default gen_random_uuid(),
    seller_id       uuid not null references users(id),
    game            text not null,
    catalog_card_id text not null,
    card_name       text not null,
    set_name        text not null default '',
    card_number     text not null default '',
    rarity          text,
    image_url       text,
    condition       text not null check (condition in (
        'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
    )),
    is_foil         boolean not null default false,
    price_cents     bigint not null check (price_cents > 0),
    quantity        integer not null check (quantity >= 0),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- Soft delete: order_addons rows reference these forever, so a seller
    -- "removing" a single only hides it from their shop.
    removed_at      timestamptz
);

-- One live row per (card, condition, foil) per seller — adding the same
-- variant again updates that row's quantity/price instead of creating a
-- second, competing row for the identical item.
create unique index shop_singles_one_live_variant_idx
    on shop_singles (seller_id, catalog_card_id, condition, is_foil)
    where removed_at is null;
create index shop_singles_seller_idx on shop_singles (seller_id, card_name) where removed_at is null;

alter table shop_singles enable row level security;

-- What a specific checkout PaymentIntent authorized beyond the order's
-- primary listing — written server-side by HandleCreateCheckoutIntent, read
-- back by HandleBuyNow when the payment is resolved. Keyed by
-- PaymentIntent rather than stamped into its Stripe metadata because a
-- large bulk add-on list would blow past Stripe's 500-char metadata value
-- limit, and because the buyer's client must never be the one telling the
-- server what was bought: the PaymentIntent id is the only thing that
-- crosses back over, and these rows are what it resolves to.
create table checkout_addons (
    payment_intent_id text not null,
    kind              text not null check (kind in ('single', 'listing')),
    ref_id            uuid not null,
    quantity          integer not null check (quantity > 0),
    unit_price_cents  bigint not null check (unit_price_cents > 0),
    created_at        timestamptz not null default now(),
    primary key (payment_intent_id, kind, ref_id)
);
alter table checkout_addons enable row level security;

-- Items bought alongside an order's primary listing (order_items) — Singles
-- Shop singles and the same seller's other fixed-price listings, added at
-- checkout. Its own table rather than extra order_items rows on purpose:
-- every existing order reader (order lists, claims, buyer reviews, the
-- worker's timers) joins order_items expecting exactly one row per order,
-- the order's primary listing — keeping that invariant means none of them
-- change, and add-ons are purely additive.
create table order_addons (
    id               uuid primary key default gen_random_uuid(),
    order_id         uuid not null references orders(id),
    shop_single_id   uuid references shop_singles(id),
    listing_id       uuid references listings(id),
    quantity         integer not null check (quantity > 0),
    unit_price_cents bigint not null check (unit_price_cents > 0),
    created_at       timestamptz not null default now(),
    -- Set when the order is cancelled/refunded and the add-on released back
    -- (singles restocked) — same meaning as order_items.voided_at.
    voided_at        timestamptz,
    check ((shop_single_id is null) <> (listing_id is null)),
    check (listing_id is null or quantity = 1)
);
create index order_addons_order_id_idx on order_addons (order_id);
-- A listing sells at most once, ever — mirrors order_items_listing_id_idx.
create unique index order_addons_listing_id_idx on order_addons (listing_id) where listing_id is not null and voided_at is null;
alter table order_addons enable row level security;
