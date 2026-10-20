-- =============================================================================
-- Gym package sales in the POS cashier shift, with receipt numbers
-- =============================================================================
-- A front desk sale paid in cash, card, transfer or QRIS belongs to the
-- seller's open POS shift (pos_shift_id), so the shift close-out counts it
-- and the drawer expects its cash. A refund paid back from a shift records
-- that shift in refund_shift_id and shows there as a refund.
--
-- The POS journals each order when it is paid and journals nothing at shift
-- close. Gym sales are no POS orders and keep their own GYM_SALE_* and
-- GYM_REFUND_* journals, so linking them to a shift posts nothing twice.
--
-- Every paid purchase gets a receipt number GYM-YYYYMMDD-NNNN, numbered per
-- WIB day from gym.receipt_counters. Purchases paid before this file are
-- numbered by paid_at. Idempotent.

ALTER TABLE gym.credit_purchases
  ADD COLUMN IF NOT EXISTS pos_shift_id uuid REFERENCES pos.pos_shifts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_shift_id uuid REFERENCES pos.pos_shifts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receipt_number text;

CREATE INDEX IF NOT EXISTS credit_purchases_pos_shift_id_fk_idx
  ON gym.credit_purchases (pos_shift_id) WHERE pos_shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_purchases_refund_shift_id_fk_idx
  ON gym.credit_purchases (refund_shift_id) WHERE refund_shift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_credit_purchases_receipt_number
  ON gym.credit_purchases (receipt_number) WHERE receipt_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS gym.receipt_counters (
  day     date PRIMARY KEY,
  last_no integer NOT NULL CHECK (last_no > 0)
);

-- Number the purchases paid so far, after any number a day already used.
WITH numbered AS (
  SELECT p.id, d.day,
         COALESCE(c.last_no, 0) + row_number() OVER (PARTITION BY d.day ORDER BY p.paid_at, p.id) AS n
    FROM gym.credit_purchases p
   CROSS JOIN LATERAL (SELECT (p.paid_at AT TIME ZONE 'Asia/Jakarta')::date AS day) d
    LEFT JOIN gym.receipt_counters c ON c.day = d.day
   WHERE p.paid_at IS NOT NULL AND p.receipt_number IS NULL
)
UPDATE gym.credit_purchases p
   SET receipt_number = 'GYM-' || to_char(numbered.day, 'YYYYMMDD') || '-' || lpad(numbered.n::text, 4, '0')
  FROM numbered
 WHERE numbered.id = p.id;

INSERT INTO gym.receipt_counters (day, last_no)
SELECT to_date(split_part(receipt_number, '-', 2), 'YYYYMMDD'), max(split_part(receipt_number, '-', 3)::int)
  FROM gym.credit_purchases
 WHERE receipt_number IS NOT NULL
 GROUP BY 1
ON CONFLICT (day) DO UPDATE SET last_no = GREATEST(gym.receipt_counters.last_no, EXCLUDED.last_no);
