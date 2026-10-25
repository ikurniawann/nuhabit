-- Log email keluar (backend/internal/platform/mail).
--
-- platform.mail_log: satu baris per email yang dikirim lewat port mailer
-- (slip gaji, kode OTP, notifikasi gym, tautan dataroom, rekrutmen, email
-- uji). Baris menyimpan isi pesan supaya kegagalan sementara bisa dicoba
-- ulang oleh job integrations.mail-retry (maks. 3 percobaan) dan admin bisa
-- mengirim ulang dari Settings → Integrasi → Email.
--
-- Pengaturan provider (Resend atau Microsoft 365 lewat Graph/SMTP) ada di
-- configuration.app_settings dengan awalan mail_; env tetap jadi cadangan.
--
-- Idempotent: aman dijalankan ulang.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.mail_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL DEFAULT 'generic',
  to_address      text        NOT NULL,
  from_address    text        NOT NULL,
  from_name       text,
  subject         text        NOT NULL,
  body_html       text        NOT NULL,
  attachments     jsonb,
  provider        text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts        int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    int         NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz,
  error           text,
  message_id      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.mail_log IS
  'Outbound email log: one row per message handed to the mailer port, with the body kept for retry and manual resend.';
COMMENT ON COLUMN platform.mail_log.message_id IS
  'Provider reference: the Resend email id, the Graph client-request-id or the SMTP Message-ID header.';

CREATE INDEX IF NOT EXISTS mail_log_due_idx
  ON platform.mail_log (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS mail_log_created_idx ON platform.mail_log (created_at DESC);
