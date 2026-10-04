-- KDS step "confirmed" must persist on pos_order_items.kitchen_status.
-- Old check only allowed pending/preparing/ready/served/cancelled, so bump
-- Konfirmasi was silently mapped back to pending and the ticket never moved.

ALTER TABLE pos.pos_order_items
  DROP CONSTRAINT IF EXISTS pos_order_items_kitchen_status_check;

ALTER TABLE pos.pos_order_items
  ADD CONSTRAINT pos_order_items_kitchen_status_check
  CHECK (
    kitchen_status::text = ANY (
      ARRAY[
        'pending'::character varying,
        'confirmed'::character varying,
        'preparing'::character varying,
        'ready'::character varying,
        'served'::character varying,
        'cancelled'::character varying
      ]::text[]
    )
  );
