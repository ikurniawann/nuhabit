-- EPIC-023 Fase E (ops): Gelang Karyawan — pairing gelang NFC ↔ karyawan
-- HRIS untuk akses gate GRATIS (free access). Keputusan desain: pengaturan
-- hidup di modul TICKETING (registry gelang), BUKAN di profil karyawan —
-- gelang = aset venue (scoping branch), wewenang pairing di ops venue
-- (bukan HRD), dan siklus hidup gelang lepas dari siklus kepegawaian;
-- tabel hanya MENUNJUK ke hris.employees.

-- ============================================================
-- 1. Status gelang baru: 'karyawan' (dipegang karyawan, bukan stok
--    kunjungan) — registrasi loket/redeem menolak otomatis karena
--    mereka mensyaratkan status 'tersedia'.
-- ============================================================
ALTER TABLE ticketing.ticket_bands
  DROP CONSTRAINT IF EXISTS ticket_bands_status_check;
ALTER TABLE ticketing.ticket_bands
  ADD CONSTRAINT ticket_bands_status_check CHECK (status IN
    ('tersedia', 'dipakai', 'hilang', 'rusak', 'karyawan'));

-- ============================================================
-- 2. Pairing gelang ↔ karyawan. Riwayat dipertahankan (revoke =
--    is_active false), keunikan hanya untuk pass AKTIF.
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_staff_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  band_id uuid NOT NULL REFERENCES ticketing.ticket_bands(id),
  employee_id uuid NOT NULL REFERENCES hris.employees(id),
  is_active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES configuration.users(id),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Satu gelang hanya boleh dipegang satu karyawan aktif — dan sebaliknya
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_staff_passes_active_band
  ON ticketing.ticket_staff_passes (band_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_staff_passes_active_employee
  ON ticketing.ticket_staff_passes (branch_id, employee_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_ticket_staff_passes_branch
  ON ticketing.ticket_staff_passes (branch_id, is_active);
