-- =============================================================================
-- Defensive: pastikan tidak ada RLS/policy legacy yang masih aktif.
--
-- Baseline yang di-generate `npm run db:pull` (introspeksi pg_catalog) TIDAK
-- meng-emit policy/RLS sama sekali, jadi pada database baru file ini no-op.
-- File tetap disertakan agar aman bila di-apply ke database yang sebelumnya
-- pernah punya RLS dari platform lama. Keamanan ditangani di application layer (API).
--
-- Jalankan PALING AKHIR. Hapus file ini jika Anda ingin merancang RLS sendiri.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop semua policy di schema aplikasi (jika ada)
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'auth')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;

  -- Disable RLS di semua tabel schema aplikasi (jika ter-enable)
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'auth')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY',
      r.schemaname, r.tablename
    );
  END LOOP;
END $$;
