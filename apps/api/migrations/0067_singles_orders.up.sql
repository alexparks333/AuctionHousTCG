-- Singles-only orders: a buyer can buy a seller's Singles Shop singles on
-- their own (no listed card), subject to a minimum (auction.MinSinglesOrderCents).
--
-- Every order surface — order_items, the /listings/{id}/order/* routes,
-- labels, tracking, claims, reviews, Buy/Sold History, worker timers — is
-- keyed on one primary listing. Rather than rebuild all of that, a
-- singles-only purchase gets a hidden "container" listing (singles_order =
-- true): format 'fixed', status 'ended' from the start, price 0, never
-- shown in browse/search/profiles. Its singles are order_addons rows, the
-- same as singles added to a card's checkout.
--
-- reserved_buyer_id is who the container was opened for. buyer_id stays
-- null until they actually pay (so nothing that keys on buyer_id — the
-- purchase celebration, Buy History — fires for an abandoned cart).
alter table listings add column singles_order boolean not null default false;
alter table listings add column reserved_buyer_id uuid references users(id);

-- At most one open (unpaid) container per buyer and seller — reused each
-- time the buyer checks out of that seller's shop.
create unique index listings_open_singles_order_idx on listings (seller_id, reserved_buyer_id)
    where singles_order and buyer_id is null;
