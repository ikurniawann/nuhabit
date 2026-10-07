-- Portal member /member: pendaftaran mandiri, promo di portal, pengumuman
-- bergambar + tautan dalam portal, web push, dan peringatan saldo rendah.
-- Idempoten: aman dijalankan ulang dan aman bila workstream lain sudah
-- menambah kolom yang sama.

-- 1. Gambar + tautan dalam portal untuk pengumuman dan notifikasi ----------
-- link_url berisi tujuan portal (mis. "events", "promo:KOPI10"), bukan URL luar.
ALTER TABLE crm.member_announcements ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE crm.member_announcements ADD COLUMN IF NOT EXISTS link_url text;
ALTER TABLE crm.member_notifications ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE crm.member_notifications ADD COLUMN IF NOT EXISTS link_url text;

-- 2. Ambang saldo rendah (Rupiah); 0 = peringatan mati ------------------------
ALTER TABLE pos.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS low_balance_threshold_idr numeric DEFAULT 0;

-- 3. Campaign promo yang boleh tampil di portal member -----------------------
ALTER TABLE promo.promo_campaigns
  ADD COLUMN IF NOT EXISTS show_in_member_portal boolean NOT NULL DEFAULT false;

-- 4. Langganan web push per perangkat member ---------------------------------
CREATE TABLE IF NOT EXISTS crm.member_push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_member_push_subscriptions_customer
  ON crm.member_push_subscriptions (customer_id);

-- 5. Opt-out marketing yang diatur member sendiri dari portal ---------------
ALTER TABLE crm.crm_marketing_optouts
  DROP CONSTRAINT IF EXISTS crm_marketing_optouts_source_check;
ALTER TABLE crm.crm_marketing_optouts
  ADD CONSTRAINT crm_marketing_optouts_source_check
  CHECK (source IN ('manual', 'keyword', 'portal'));
