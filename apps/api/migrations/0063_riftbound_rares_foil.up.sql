-- Riftbound Rares (and up) only exist as foils (cardcatalog.foilOnly), so a
-- Singles Shop row for one is always the foil finish. Rows stocked before
-- that rule as non-foil are flipped to foil, unless the seller already has
-- a live foil row for the same card + condition (the unique live-variant
-- index would reject the flip) — those are folded into the foil row.
update shop_singles f
set quantity = least(f.quantity + n.quantity, 9999), updated_at = now()
from shop_singles n
where n.game = 'Riftbound' and n.rarity not in ('Common', 'Uncommon')
  and not n.is_foil and n.removed_at is null
  and f.seller_id = n.seller_id and f.catalog_card_id = n.catalog_card_id
  and f.condition = n.condition and f.is_foil and f.removed_at is null;

update shop_singles n
set removed_at = now(), updated_at = now()
where n.game = 'Riftbound' and n.rarity not in ('Common', 'Uncommon')
  and not n.is_foil and n.removed_at is null
  and exists (
    select 1 from shop_singles f
    where f.seller_id = n.seller_id and f.catalog_card_id = n.catalog_card_id
      and f.condition = n.condition and f.is_foil and f.removed_at is null
  );

update shop_singles
set is_foil = true, updated_at = now()
where game = 'Riftbound' and rarity not in ('Common', 'Uncommon')
  and not is_foil and removed_at is null;
