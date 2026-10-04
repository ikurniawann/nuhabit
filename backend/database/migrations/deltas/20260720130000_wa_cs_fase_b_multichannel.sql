-- EPIC-013 Fase B: fondasi multi-kanal untuk inbox CS.
--
-- Percakapan sebelumnya dikunci pada `phone` — khas WhatsApp. Instagram tidak
-- memberi nomor telepon, hanya id pengguna ber-scope aplikasi. Karena itu
-- identitas percakapan dipindah ke pasangan (channel, external_id):
--   whatsapp  → external_id = digit nomor (sama seperti `phone` selama ini)
--   instagram → external_id = IGSID (id pengirim menurut Meta)
--
-- CATATAN NAMA TABEL: tabel tetap bernama `wa_*` walau kini multi-kanal.
-- Mengganti namanya menyentuh belasan berkas yang sudah teruji tanpa memberi
-- manfaat fungsional — utang penamaan ini sengaja diterima dan dicatat.

-- 1) Percakapan ---------------------------------------------------------
ALTER TABLE crm.wa_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS external_id text,
  -- Nama tampilan dari kanal (pushName WA / username IG). Untuk kanal tanpa
  -- profil member, inilah satu-satunya identitas yang bisa ditampilkan.
  ADD COLUMN IF NOT EXISTS display_name text;

UPDATE crm.wa_conversations
   SET external_id = phone
 WHERE external_id IS NULL;

ALTER TABLE crm.wa_conversations ALTER COLUMN external_id SET NOT NULL;
-- Instagram tidak punya nomor telepon.
ALTER TABLE crm.wa_conversations ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE crm.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_channel_check;
ALTER TABLE crm.wa_conversations
  ADD CONSTRAINT wa_conversations_channel_check
  CHECK (channel = ANY (ARRAY['whatsapp', 'instagram']));

-- Kunci identitas pindah dari phone ke (channel, external_id).
ALTER TABLE crm.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS wa_conversations_channel_external_uniq
  ON crm.wa_conversations (channel, external_id);
CREATE INDEX IF NOT EXISTS wa_conversations_channel_idx
  ON crm.wa_conversations (channel, last_message_at DESC);

-- 2) Pesan --------------------------------------------------------------
ALTER TABLE crm.wa_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS external_id text;

UPDATE crm.wa_messages
   SET external_id = phone
 WHERE external_id IS NULL;

ALTER TABLE crm.wa_messages ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE crm.wa_messages DROP CONSTRAINT IF EXISTS wa_messages_channel_check;
ALTER TABLE crm.wa_messages
  ADD CONSTRAINT wa_messages_channel_check
  CHECK (channel = ANY (ARRAY['whatsapp', 'instagram']));

CREATE INDEX IF NOT EXISTS wa_messages_channel_idx
  ON crm.wa_messages (channel, created_at DESC);

COMMENT ON COLUMN crm.wa_conversations.external_id IS
  'Identitas pengirim di kanalnya: digit nomor (whatsapp) atau IGSID (instagram).';
COMMENT ON COLUMN crm.wa_conversations.display_name IS
  'Nama tampilan dari kanal — dipakai saat percakapan tidak tertaut member.';
