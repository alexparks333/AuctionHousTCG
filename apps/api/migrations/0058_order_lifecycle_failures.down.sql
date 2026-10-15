alter table claims drop constraint claims_reason_code_check;
alter table claims add constraint claims_reason_code_check
    check (reason_code in (
        'not_as_described', 'not_received_no_tracking', 'not_received_tracking_delivered',
        'payment_fraud', 'buyers_remorse', 'transit_damage'
    ));

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in (
        'won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review',
        'offer_received', 'offer_accepted', 'offer_declined'
    ));
alter table notifications drop column second_chance_offer_id;

drop table seller_ship_strikes;
drop table account_suspensions;
drop table second_chance_offers;

drop index order_items_listing_id_live_idx;
create unique index order_items_listing_id_idx on order_items (listing_id);
alter table order_items drop column voided_at;

alter table orders
    drop column ship_deadline,
    drop column ship_extension_used_at;
