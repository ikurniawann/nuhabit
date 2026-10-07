-- EPIC-009: halaman Logbook List dilebur ke tab Riwayat di /dashboard/hris/logbook.
-- Nonaktifkan menu lama (halaman tetap redirect utk bookmark lama).
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    updated_at = now()
WHERE code = 'hris.performance.logbook-list';
