-- Rename Tax (PPN) label → Tax (display only). Idempotent.

UPDATE pos.pos_billing_charges
SET name = 'Tax',
    updated_at = now()
WHERE code = 'TAX'
  AND name = 'Tax (PPN)';
