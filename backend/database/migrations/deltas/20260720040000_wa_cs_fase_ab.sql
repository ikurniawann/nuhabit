-- EPIC-012 Fase A+B: riwayat pesan WhatsApp (outbox log) + model percakapan
-- (fondasi inbox 2-arah).
--
-- Aturan privasi: body pesan OTP TIDAK PERNAH disimpan (kolom body NULL,
-- message_type='otp') — kode OTP tersimpan = siapa pun pembaca tabel bisa
-- login sebagai member.

-- 1) Percakapan per nomor ----------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.wa_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(40) NOT NULL UNIQUE,          -- digit ternormalisasi 62xxx
  customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  assigned_user_id uuid,
  unread_count int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_conversations_status_check
    CHECK (status = ANY (ARRAY['open','in_progress','waiting_customer','resolved'])),
  CONSTRAINT wa_conversations_unread_nonnegative CHECK (unread_count >= 0)
);
CREATE INDEX IF NOT EXISTS wa_conversations_status_idx
  ON crm.wa_conversations (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS wa_conversations_customer_idx
  ON crm.wa_conversations (customer_id);

-- 2) Semua pesan (keluar & masuk) --------------------------------------------
CREATE TABLE IF NOT EXISTS crm.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES crm.wa_conversations(id) ON DELETE SET NULL,
  direction text NOT NULL,
  message_type text NOT NULL DEFAULT 'chat',
  phone varchar(40) NOT NULL,
  customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  body text,                                   -- NULL untuk otp
  media_type text,                             -- image|video|audio|document|sticker
  status text NOT NULL DEFAULT 'sent',
  provider text,
  provider_message_id text,
  error_reason text,
  sent_by_user_id uuid,
  -- true = pesan keluar yang diketik manual dari HP nomor bisnis (bukan dari
  -- dashboard/gateway API) — tertangkap lewat event fromMe.
  wa_from_me boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_messages_direction_check CHECK (direction = ANY (ARRAY['in','out'])),
  CONSTRAINT wa_messages_type_check
    CHECK (message_type = ANY (ARRAY['otp','notification','chat','broadcast','system'])),
  CONSTRAINT wa_messages_status_check
    CHECK (status = ANY (ARRAY['queued','sent','failed','received'])),
  CONSTRAINT wa_messages_otp_no_body CHECK (message_type <> 'otp' OR body IS NULL)
);

-- Dedup: event fromMe dari gateway meng-echo pesan yang baru saja dikirim via
-- API (id sama) — index unik ini membuat echo jatuh ke ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_provider_id_uniq
  ON crm.wa_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_messages_conversation_idx
  ON crm.wa_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS wa_messages_phone_idx
  ON crm.wa_messages (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS wa_messages_type_idx
  ON crm.wa_messages (message_type, created_at DESC);
CREATE INDEX IF NOT EXISTS wa_messages_status_idx
  ON crm.wa_messages (status) WHERE status = 'failed';

DROP TRIGGER IF EXISTS wa_conversations_set_updated_at ON crm.wa_conversations;
CREATE TRIGGER wa_conversations_set_updated_at
  BEFORE UPDATE ON crm.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();
