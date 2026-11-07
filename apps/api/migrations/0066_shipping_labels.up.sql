-- Every shipping label bought for an order, not just the current one
-- (orders.provider_shipment_id/tracking_number/label_url still hold the
-- current label). Lets "Change Shipping Label" cap how many labels an order
-- can have (shipping.MaxLabelsPerOrder), and records whether each replaced
-- Shippo label was refunded — so no label is ever paid for twice without a
-- trace. Pitney Bowes envelope labels can't be refunded, so their rows never
-- get a refund_status.
create table shipping_labels (
    id                  uuid primary key default gen_random_uuid(),
    order_id            uuid not null references orders(id),
    mechanism           text not null check (mechanism in ('letter', 'package')),
    provider_id         text not null,
    carrier             text,
    tracking_number     text,
    cost_cents          bigint not null default 0,
    created_at          timestamptz not null default now(),
    -- requested: Shippo accepted the refund and is processing it;
    -- refunded: Shippo confirmed it; rejected: Shippo refused (e.g. the
    -- carrier already scanned the label). refund_detail holds Shippo's reason.
    refund_status       text check (refund_status in ('requested', 'refunded', 'rejected')),
    refund_requested_at timestamptz,
    refund_detail       text
);

create index shipping_labels_order_id_idx on shipping_labels (order_id, created_at);

alter table shipping_labels enable row level security;

-- Existing orders' current labels.
insert into shipping_labels (order_id, mechanism, provider_id, carrier, tracking_number, cost_cents)
select id,
       -- Same rule as HandleBuyLabel: a missing/unknown preset is treated as
       -- a tracked envelope.
       case when shipping_preset in ('shippo_ground_advantage', 'free_bubble_mailer', 'free_box') then 'package' else 'letter' end,
       provider_shipment_id, carrier, tracking_number, coalesce(label_cost_cents, 0)
from orders
where provider_shipment_id is not null;
