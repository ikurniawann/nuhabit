-- Pending topup support for Xendit QRIS before balance is credited
ALTER TABLE pos.pos_wallet_transactions
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'completed';

ALTER TABLE pos.pos_wallet_transactions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE pos.pos_wallet_transactions
  DROP CONSTRAINT IF EXISTS pos_wallet_transactions_status_check;

ALTER TABLE pos.pos_wallet_transactions
  ADD CONSTRAINT pos_wallet_transactions_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'completed'::text,
    'expired'::text,
    'failed'::text,
    'cancelled'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_wallet_xendit_tx_unique
  ON pos.pos_wallet_transactions (xendit_transaction_id)
  WHERE xendit_transaction_id IS NOT NULL AND btrim(xendit_transaction_id) <> '';

CREATE INDEX IF NOT EXISTS idx_pos_wallet_status
  ON pos.pos_wallet_transactions (status, created_at DESC);

COMMENT ON COLUMN pos.pos_wallet_transactions.status IS
  'pending=awaiting payment gateway; completed=credited; expired/failed/cancelled=not credited';
