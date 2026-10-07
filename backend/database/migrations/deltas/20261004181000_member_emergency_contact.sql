-- Aplikasi member (port NüHabit): kontak darurat dan waiver digital member.
-- emergency_contact = {"name": text, "phone": text, "relation": text}; NULL = belum diisi.
-- waiver_version + waiver_accepted_at diisi saat member menyetujui waiver di pendaftaran.
-- Idempotent.

ALTER TABLE pos.pos_customers ADD COLUMN IF NOT EXISTS emergency_contact jsonb;
ALTER TABLE pos.pos_customers ADD COLUMN IF NOT EXISTS waiver_version text;
ALTER TABLE pos.pos_customers ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamptz;
