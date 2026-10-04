-- Dropdown "Outlet" di seluruh app (portal karir, kandidat, pipeline, dsb.)
-- membaca item.brands, sedangkan sumber kebenaran outlet adalah
-- Business hierarchy level Branch (configuration.branches).
--
-- Solusi: item.brands menjadi MIRROR otomatis dari configuration.branches
-- (id sama persis), via backfill + trigger. Dengan begitu semua FK existing
-- (candidates, job_openings, positions, staff, users, …) tetap valid dan
-- perubahan Branch di Settings → Business langsung tercermin.
--
-- Kebijakan delete: branch dihapus → brand DI-NONAKTIFKAN (bukan dihapus),
-- karena beberapa FK ke brands memakai ON DELETE CASCADE (departments,
-- positions, sections, staff) dan cascade destruktif tidak diinginkan.

-- ── Backfill dari branches yang sudah ada ─────────────────────────────
INSERT INTO item.brands (id, name, is_active)
SELECT b.id, b.name, b.is_active
FROM configuration.branches b
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      is_active = EXCLUDED.is_active;

-- ── Trigger sync ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION configuration.sync_branch_to_brands()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE item.brands SET is_active = false WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO item.brands (id, name, is_active)
  VALUES (NEW.id, NEW.name, NEW.is_active)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_branch_to_brands ON configuration.branches;
CREATE TRIGGER trg_sync_branch_to_brands
AFTER INSERT OR UPDATE OR DELETE ON configuration.branches
FOR EACH ROW EXECUTE FUNCTION configuration.sync_branch_to_brands();
