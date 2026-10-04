-- EPIC-004 TG1: Offer — penawaran kerja per kandidat + portal respons token.
--
-- 1. Penawaran per kandidat: satu revisi = satu baris (version naik);
--    revisi baru otomatis meng-expire offer non-terminal sebelumnya.
--    Token unik utk portal kandidat /offer/[token] (terima/nego/tolak
--    online, respons + timestamp + IP tercatat sebagai bukti digital).
-- 2. Range gaji per posisi (nullable) — panel offer memberi peringatan
--    lunak bila offer melebihi salary_max.

-- ── 1. Penawaran kerja ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.candidate_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES recruitment.candidates(id) ON DELETE CASCADE,
  version         integer NOT NULL DEFAULT 1,
  token           text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'negotiating', 'accepted', 'declined', 'expired')),
  -- snapshot judul posisi saat offer dibuat (posisi master bisa berubah)
  position_title  text,
  base_salary     numeric NOT NULL CHECK (base_salary >= 0),
  -- daftar benefit/tunjangan: ["BPJS Kesehatan & TK", "Tunjangan makan", ...]
  benefits        jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_date      date,
  notes           text,
  -- respons kandidat (via portal atau dicatat manual HRD)
  response_note   text,
  responded_at    timestamptz,
  response_ip     text,
  response_source text CHECK (response_source IS NULL OR response_source IN ('portal', 'manual')),
  sent_at         timestamptz,
  expires_at      timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, version)
);

CREATE INDEX IF NOT EXISTS idx_candidate_offers_candidate
  ON recruitment.candidate_offers (candidate_id, version DESC);

DROP TRIGGER IF EXISTS update_candidate_offers_updated_at ON recruitment.candidate_offers;
CREATE TRIGGER update_candidate_offers_updated_at
  BEFORE UPDATE ON recruitment.candidate_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Range gaji posisi (referensi budget offer) ──────────────────────
ALTER TABLE hris.positions ADD COLUMN IF NOT EXISTS salary_min numeric CHECK (salary_min IS NULL OR salary_min >= 0);
ALTER TABLE hris.positions ADD COLUMN IF NOT EXISTS salary_max numeric CHECK (salary_max IS NULL OR salary_max >= 0);
