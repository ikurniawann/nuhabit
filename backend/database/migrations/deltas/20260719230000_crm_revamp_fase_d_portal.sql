-- EPIC-011 Fase D: portal member (member.suluindwounderland.com) —
-- login OTP WhatsApp (Fonnte) + sesi portal terpisah dari arkiv_session.

CREATE TABLE IF NOT EXISTS crm.member_portal_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(40) NOT NULL,               -- digit ternormalisasi (62...)
  code_hash text NOT NULL,                  -- sha256(kode 6 digit)
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_portal_otp_phone
  ON crm.member_portal_otp (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS crm.member_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,          -- sha256(token cookie)
  customer_id uuid NOT NULL REFERENCES pos_customers(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_member_portal_sessions_customer
  ON crm.member_portal_sessions (customer_id);
