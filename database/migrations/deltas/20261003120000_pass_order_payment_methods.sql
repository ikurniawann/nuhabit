-- =============================================================================
-- Member App — metode bayar paket online: QRIS, Virtual Account, kartu kredit.
-- DEV memakai simulator pembayaran (env PAYMENT_SIMULATOR=1, gateway
-- 'simulator'): instruksi bayar tampil seperti sungguhan, pembayaran
-- diperlakukan sukses lewat tombol simulasi. Produksi: QRIS via Xendit;
-- VA & kartu menunggu integrasi Xendit (tidak ditawarkan bila belum ada).
-- =============================================================================
ALTER TABLE studio.pass_orders ADD COLUMN IF NOT EXISTS payment_method varchar(10) NOT NULL DEFAULT 'qris';
ALTER TABLE studio.pass_orders DROP CONSTRAINT IF EXISTS studio_pass_orders_payment_method_check;
ALTER TABLE studio.pass_orders ADD CONSTRAINT studio_pass_orders_payment_method_check CHECK (payment_method IN ('qris', 'va', 'card'));
ALTER TABLE studio.pass_orders ADD COLUMN IF NOT EXISTS va_bank varchar(20);
ALTER TABLE studio.pass_orders ADD COLUMN IF NOT EXISTS va_number varchar(40);
ALTER TABLE studio.pass_orders ADD COLUMN IF NOT EXISTS card_last4 varchar(4);
