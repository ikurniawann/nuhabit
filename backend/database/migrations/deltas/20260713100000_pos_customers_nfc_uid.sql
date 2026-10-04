-- NFC card UID for POS member cards (ACS ACR1555 / keyboard wedge / bridge).
ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS nfc_uid varchar(64);

COMMENT ON COLUMN pos.pos_customers.nfc_uid IS
  'Contactless card UID (hex). Used for NFC member lookup; unique when set.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_customers_nfc_uid
  ON pos.pos_customers (nfc_uid)
  WHERE nfc_uid IS NOT NULL AND btrim(nfc_uid) <> '';
