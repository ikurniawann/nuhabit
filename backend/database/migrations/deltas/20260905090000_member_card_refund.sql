-- Refund saldo member saat kartu dilepas (permintaan owner 2026-09-04).
--
-- Alur: tombol "Refund" di halaman Unlink Card = kartu dilepas (alasan
-- 'refund') + permintaan refund dicatat (status 'requested') dengan saldo saat
-- itu. Setelah Finance mengonfirmasi uang sudah dikembalikan, kasir/supervisor
-- menandai "Refund Completed" (PIN supervisor): saldo ARK member di-nol-kan
-- lewat transaksi wallet type 'withdrawal' / payment_method 'refund', status
-- permintaan menjadi 'completed'. XP tidak disentuh.

ALTER TABLE pos.pos_card_unlink_logs DROP CONSTRAINT IF EXISTS pos_card_unlink_logs_reason_check;
ALTER TABLE pos.pos_card_unlink_logs
  ADD CONSTRAINT pos_card_unlink_logs_reason_check
  CHECK (reason IN ('lost', 'returned', 'other', 'refund'));

CREATE TABLE IF NOT EXISTS pos.pos_member_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  unlink_log_id uuid REFERENCES pos.pos_card_unlink_logs(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'completed', 'cancelled')),
  requested_amount numeric(14,2) NOT NULL DEFAULT 0,
  refunded_amount numeric(14,2),
  notes text,
  requested_by uuid,
  requested_by_name varchar(120),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid,
  completed_by_name varchar(120),
  approved_by_id uuid,
  approved_by_name varchar(120),
  completed_at timestamptz,
  completion_notes text,
  cancelled_by uuid,
  cancelled_by_name varchar(120),
  cancelled_at timestamptz,
  cancel_reason text,
  wallet_transaction_id uuid,
  company_id uuid,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_member_refund_requests_status
  ON pos.pos_member_refund_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_member_refund_requests_customer
  ON pos.pos_member_refund_requests(customer_id, requested_at DESC);
-- Satu permintaan aktif per member.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_member_refund_requests_open
  ON pos.pos_member_refund_requests(customer_id) WHERE status = 'requested';
