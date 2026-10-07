-- EPIC-015 Fase A: pensiunkan modul jadwal lama berbasis tabel `staff`.
-- Schedules (staff_schedules) digantikan Shift Kerja (hris.shifts +
-- hris.employee_shifts) yang jadi sumber kebenaran jadwal untuk absensi, cuti,
-- lembur, dan payroll. Sections (staff_sections) ikut pensiun karena bersandar
-- pada tabel `staff` yang sama-sama kosong.
-- Halaman tetap ada sebagai redirect permanen untuk bookmark lama.
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    updated_at = now()
WHERE code IN ('hris.workforce.schedules', 'hris.organization.sections');
