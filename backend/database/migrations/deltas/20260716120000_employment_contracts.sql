-- Kontrak karyawan (PKWTT / PKWT) — Fase A modul kontrak.
-- Acuan compliance: UU 13/2003 jo. UU Cipta Kerja + PP 35/2021:
--   • PKWT wajib punya end_date dan TIDAK boleh punya masa percobaan (CHECK).
--   • Batas total PKWT 5 tahun & kompensasi dihitung di aplikasi
--     (src/lib/hris/contracts.ts) karena butuh agregasi rantai kontrak.
--   • Snapshot posisi/departemen/gaji disimpan di kontrak agar isi kontrak
--     tidak berubah saat master data berubah.

CREATE TABLE IF NOT EXISTS hris.employment_contracts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  contract_number        text NOT NULL UNIQUE,
  contract_type          text NOT NULL CHECK (contract_type IN ('pkwtt', 'pkwt')),
  status                 text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'ended', 'terminated', 'converted')),
  start_date             date NOT NULL,
  end_date               date,
  probation_end_date     date,
  -- rantai perpanjangan PKWT (kontrak lanjutan menunjuk kontrak sebelumnya)
  parent_contract_id     uuid REFERENCES hris.employment_contracts(id),
  sequence               integer NOT NULL DEFAULT 1,
  -- snapshot isi kontrak (Pasal 54 UU 13/2003)
  position_title         text,
  department_name        text,
  work_location          text,
  base_salary            numeric(15,2),
  allowances             jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- administrasi & compliance
  signed_at              date,
  signed_document_url    text,
  kemnaker_registered_at date,
  compensation_amount    numeric(15,2),
  compensation_paid_at   date,
  terminated_reason      text,
  notes                  text,
  created_by_name        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pkwt_needs_end_date CHECK (contract_type <> 'pkwt' OR end_date IS NOT NULL),
  CONSTRAINT pkwt_no_probation   CHECK (contract_type <> 'pkwt' OR probation_end_date IS NULL),
  CONSTRAINT end_after_start     CHECK (end_date IS NULL OR end_date > start_date)
);

-- satu kontrak aktif per karyawan
CREATE UNIQUE INDEX IF NOT EXISTS employment_contracts_one_active
  ON hris.employment_contracts (employee_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS employment_contracts_employee_idx
  ON hris.employment_contracts (employee_id, created_at DESC);

-- kontrak PKWT yang akan berakhir (dashboard pengingat, Fase C)
CREATE INDEX IF NOT EXISTS employment_contracts_expiring_idx
  ON hris.employment_contracts (end_date) WHERE status = 'active';

DROP TRIGGER IF EXISTS update_employment_contracts_updated_at ON hris.employment_contracts;
CREATE TRIGGER update_employment_contracts_updated_at
  BEFORE UPDATE ON hris.employment_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
