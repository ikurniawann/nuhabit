-- Allow closing a partially received PO when supplier will not replace shortage.
-- Stores close metadata separately from cancel fields.

ALTER TABLE purchasing.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchasing.purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (
    status::text = ANY (
      ARRAY[
        'draft'::text,
        'approved'::text,
        'sent'::text,
        'partially_received'::text,
        'received'::text,
        'cancelled'::text,
        'closed'::text
      ]
    )
  );

ALTER TABLE purchasing.purchase_orders
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES hris.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_reason text;
