-- EPIC-012 Fase D: penanganan komplain terukur — kategori & prioritas,
-- catatan internal antar-agent, SLA respons pertama + eskalasi, auto-reply
-- di luar jam operasional, dan CSAT saat penutupan.

-- 1) Kolom komplain & SLA pada percakapan --------------------------------
ALTER TABLE crm.wa_conversations
  ADD COLUMN IF NOT EXISTS is_complaint boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  -- Jam pesan customer pertama yang BELUM dibalas. NULL = tidak ada yang
  -- menunggu (semua sudah dibalas) — inilah dasar hitung SLA respons.
  ADD COLUMN IF NOT EXISTS awaiting_since timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_seconds int,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_seconds int,
  ADD COLUMN IF NOT EXISTS sla_response_breached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_reply_sent_on date,
  ADD COLUMN IF NOT EXISTS csat_score int,
  ADD COLUMN IF NOT EXISTS csat_asked_at timestamptz;

ALTER TABLE crm.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_category_check;
ALTER TABLE crm.wa_conversations
  ADD CONSTRAINT wa_conversations_category_check
  CHECK (category IS NULL OR category = ANY (ARRAY['produk','layanan','pembayaran','lainnya']));

ALTER TABLE crm.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_priority_check;
ALTER TABLE crm.wa_conversations
  ADD CONSTRAINT wa_conversations_priority_check
  CHECK (priority = ANY (ARRAY['low','normal','high','urgent']));

ALTER TABLE crm.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_csat_check;
ALTER TABLE crm.wa_conversations
  ADD CONSTRAINT wa_conversations_csat_check
  CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5);

COMMENT ON COLUMN crm.wa_conversations.awaiting_since IS
  'Waktu pesan customer pertama yang belum dibalas; NULL bila tidak ada yang menunggu. Dasar SLA respons pertama.';

-- Pencarian percakapan yang melanggar SLA (dispatcher jalan tiap menit).
CREATE INDEX IF NOT EXISTS wa_conversations_awaiting_idx
  ON crm.wa_conversations (awaiting_since)
  WHERE awaiting_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_conversations_complaint_idx
  ON crm.wa_conversations (is_complaint, status, priority)
  WHERE is_complaint;

-- 2) Catatan internal antar-agent (TIDAK terkirim ke customer) -----------
CREATE TABLE IF NOT EXISTS crm.wa_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES crm.wa_conversations(id) ON DELETE CASCADE,
  author_user_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_internal_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS wa_internal_notes_conversation_idx
  ON crm.wa_internal_notes (conversation_id, created_at DESC);

-- 3) Konfigurasi CS (dapat diubah Super Admin lewat CRM Settings) --------
-- value bertipe jsonb: angka/boolean sbg literal JSON, teks sbg JSON string.
INSERT INTO crm.crm_settings (key, value)
SELECT seed.key, seed.value::jsonb FROM (VALUES
  ('cs_sla_response_minutes', '15'),
  ('cs_sla_resolution_minutes', '1440'),
  ('cs_business_hours_start', '10'),
  ('cs_business_hours_end', '22'),
  ('cs_auto_reply_enabled', 'true'),
  ('cs_auto_reply_text',
   to_jsonb('Terima kasih sudah menghubungi Sulu Wonderland. Saat ini di luar jam operasional kami (10.00-22.00 WIB). Pesan Anda sudah kami terima dan akan dibalas pada jam operasional berikutnya.'::text)::text),
  ('cs_csat_enabled', 'true'),
  ('cs_csat_text',
   to_jsonb('Terima kasih sudah menghubungi kami. Boleh beri penilaian layanan kami? Balas dengan angka 1-5 (5 = sangat puas).'::text)::text)
) AS seed(key, value)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.crm_settings s WHERE s.key = seed.key
);

-- 4) Backfill awaiting_since untuk percakapan yang sudah ada -------------
-- Percakapan dianggap "menunggu" bila pesan terakhirnya dari customer.
UPDATE crm.wa_conversations v
   SET awaiting_since = sub.last_in
  FROM (
    SELECT m.conversation_id,
           MAX(m.created_at) FILTER (WHERE m.direction = 'in') AS last_in,
           MAX(m.created_at) FILTER (WHERE m.direction = 'out') AS last_out
      FROM crm.wa_messages m
     WHERE m.conversation_id IS NOT NULL
     GROUP BY m.conversation_id
  ) sub
 WHERE v.id = sub.conversation_id
   AND v.awaiting_since IS NULL
   AND sub.last_in IS NOT NULL
   AND (sub.last_out IS NULL OR sub.last_in > sub.last_out);
