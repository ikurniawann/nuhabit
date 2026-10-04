-- =============================================================================
-- Workstream E: inventori, pembelian, operasional
--
--   1. Batch & kedaluwarsa: inventory.stock_batches + ledger konsumsi, trigger
--      FEFO pada inventory.inventory_movements (titik pusat semua mutasi stok).
--   2. Audit trail server-side: audit.audit_log (append-only).
--   3. Kemasan (pack) multi-ukuran: kolom tambahan di
--      item.raw_material_unit_conversions + migrasi satuan besar/kecil.
--   4. Revisi retur pembelian, void pembayaran AP, kredit vendor ber-expiry.
--   5. Menu IAM halaman baru.
--
-- Idempotent: aman dijalankan ulang.
-- =============================================================================

-- 1. Batch & kedaluwarsa ------------------------------------------------------

ALTER TABLE inventory.inventory_movements
  ADD COLUMN IF NOT EXISTS batch_number varchar(100),
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS batch_id uuid;

COMMENT ON COLUMN inventory.inventory_movements.batch_number IS
  'Nomor batch dari supplier (diisi saat GRN). Dipakai trigger untuk membuat batch.';
COMMENT ON COLUMN inventory.inventory_movements.expiry_date IS
  'Tanggal kedaluwarsa batch masuk. Bila kosong pada GRN, trigger memakai raw_materials.shelf_life_days.';
COMMENT ON COLUMN inventory.inventory_movements.batch_id IS
  'Batch sasaran untuk pengurangan (mis. scrap batch kedaluwarsa); dikonsumsi lebih dulu sebelum FEFO.';

CREATE TABLE IF NOT EXISTS inventory.stock_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id        uuid NOT NULL REFERENCES inventory.inventory(id) ON DELETE CASCADE,
  raw_material_id     uuid NOT NULL REFERENCES item.raw_materials(id) ON DELETE CASCADE,
  warehouse_id        uuid REFERENCES configuration.warehouses(id) ON DELETE SET NULL,
  branch_id           uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  batch_number        varchar(100),
  expiry_date         date,
  qty_received        numeric(15,3) NOT NULL DEFAULT 0,
  qty_remaining       numeric(15,3) NOT NULL DEFAULT 0 CHECK (qty_remaining >= 0),
  unit_cost           numeric(15,2) NOT NULL DEFAULT 0,
  received_at         timestamptz NOT NULL DEFAULT now(),
  source_type         varchar(50) NOT NULL DEFAULT 'movement',
  source_reference_id uuid,
  source_movement_id  uuid REFERENCES inventory.inventory_movements(id) ON DELETE SET NULL,
  parent_batch_id     uuid REFERENCES inventory.stock_batches(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory.stock_batches IS
  'Stok per batch per item per gudang. Jumlah qty_remaining per inventory_id mengikuti inventory.qty_available; diisi & dikurangi oleh trigger trg_inventory_movement_batches (FEFO).';

CREATE INDEX IF NOT EXISTS idx_stock_batches_inventory_open
  ON inventory.stock_batches (inventory_id, expiry_date NULLS LAST, received_at)
  WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry_open
  ON inventory.stock_batches (expiry_date)
  WHERE qty_remaining > 0 AND expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_batches_warehouse ON inventory.stock_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_material ON inventory.stock_batches (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_source_ref ON inventory.stock_batches (source_reference_id);

CREATE TABLE IF NOT EXISTS inventory.stock_batch_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES inventory.stock_batches(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES inventory.inventory_movements(id) ON DELETE CASCADE,
  qty         numeric(15,3) NOT NULL,
  qty_before  numeric(15,3) NOT NULL,
  qty_after   numeric(15,3) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory.stock_batch_movements IS
  'Bagian tiap batch pada satu mutasi stok (negatif = keluar, positif = masuk).';

CREATE INDEX IF NOT EXISTS idx_stock_batch_movements_movement ON inventory.stock_batch_movements (movement_id);
CREATE INDEX IF NOT EXISTS idx_stock_batch_movements_batch ON inventory.stock_batch_movements (batch_id);

-- Trigger: setiap baris inventory_movements yang mengubah saldo menyesuaikan batch.
--   Saldo turun  → konsumsi FEFO: batch sasaran (batch_id) dulu, lalu batch milik
--                  GRN yang dibatalkan, lalu batch belum kedaluwarsa dengan
--                  tanggal terdekat, tanpa tanggal paling akhir, baru batch yang
--                  sudah kedaluwarsa. Sisa yang tak tertutup batch diabaikan
--                  (stok tanpa batch). Urutan ini cermin allocateFefo() di
--                  src/lib/inventory/batches.ts.
--   Saldo naik   → transfer masuk menyalin batch asal (nomor & tanggal ikut
--                  pindah); selain itu satu batch baru. GRN tanpa tanggal
--                  kedaluwarsa memakai shelf_life_days bahan baku.
CREATE OR REPLACE FUNCTION inventory.fn_inventory_movement_batches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta     numeric := COALESCE(NEW.qty_after, 0) - COALESCE(NEW.qty_before, 0);
  v_need      numeric;
  v_take      numeric;
  v_batch     record;
  v_src       record;
  v_inv       record;
  v_expiry    date;
  v_shelf     integer;
  v_new_id    uuid;
  v_today     date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF NEW.is_active IS FALSE OR v_delta = 0 THEN
    RETURN NEW;
  END IF;

  IF v_delta < 0 THEN
    v_need := -v_delta;
    FOR v_batch IN
      SELECT b.id, b.qty_remaining
        FROM inventory.stock_batches b
       WHERE b.inventory_id = NEW.inventory_id
         AND b.qty_remaining > 0
       ORDER BY
         (NEW.batch_id IS NOT NULL AND b.id = NEW.batch_id) DESC,
         (NEW.reference_type = 'grn_delete' AND b.source_reference_id = NEW.reference_id) DESC,
         (b.expiry_date IS NOT NULL AND b.expiry_date < v_today) ASC,
         b.expiry_date ASC NULLS LAST,
         b.received_at ASC,
         b.created_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_batch.qty_remaining, v_need);
      UPDATE inventory.stock_batches
         SET qty_remaining = qty_remaining - v_take, updated_at = now()
       WHERE id = v_batch.id;
      INSERT INTO inventory.stock_batch_movements (batch_id, movement_id, qty, qty_before, qty_after)
      VALUES (v_batch.id, NEW.id, -v_take, v_batch.qty_remaining, v_batch.qty_remaining - v_take);
      v_need := v_need - v_take;
    END LOOP;
    RETURN NEW;
  END IF;

  SELECT warehouse_id, branch_id INTO v_inv
    FROM inventory.inventory WHERE id = NEW.inventory_id;

  -- Transfer masuk: salin batch yang keluar dari gudang asal.
  IF NEW.reference_type = 'stock_transfer' AND NEW.tipe = 'in' AND NEW.reference_id IS NOT NULL THEN
    FOR v_src IN
      SELECT sb.id, sb.batch_number, sb.expiry_date, sb.unit_cost, sb.received_at, -sbm.qty AS qty
        FROM inventory.inventory_movements om
        JOIN inventory.stock_batch_movements sbm ON sbm.movement_id = om.id
        JOIN inventory.stock_batches sb ON sb.id = sbm.batch_id
       WHERE om.reference_type = 'stock_transfer'
         AND om.reference_id = NEW.reference_id
         AND om.tipe = 'out'
         AND om.raw_material_id = NEW.raw_material_id
         AND sbm.qty < 0
       ORDER BY sbm.created_at, sb.expiry_date NULLS LAST
    LOOP
      EXIT WHEN v_delta <= 0;
      v_take := LEAST(v_src.qty, v_delta);
      INSERT INTO inventory.stock_batches (
        inventory_id, raw_material_id, warehouse_id, branch_id, batch_number, expiry_date,
        qty_received, qty_remaining, unit_cost, received_at, source_type,
        source_reference_id, source_movement_id, parent_batch_id
      ) VALUES (
        NEW.inventory_id, NEW.raw_material_id, COALESCE(NEW.warehouse_id, v_inv.warehouse_id),
        COALESCE(NEW.branch_id, v_inv.branch_id), v_src.batch_number, v_src.expiry_date,
        v_take, v_take, v_src.unit_cost, v_src.received_at, 'stock_transfer',
        NEW.reference_id, NEW.id, v_src.id
      ) RETURNING id INTO v_new_id;
      INSERT INTO inventory.stock_batch_movements (batch_id, movement_id, qty, qty_before, qty_after)
      VALUES (v_new_id, NEW.id, v_take, 0, v_take);
      v_delta := v_delta - v_take;
    END LOOP;
    IF v_delta <= 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  v_expiry := NEW.expiry_date;
  IF v_expiry IS NULL AND NEW.reference_type = 'grn' THEN
    SELECT shelf_life_days INTO v_shelf FROM item.raw_materials WHERE id = NEW.raw_material_id;
    IF COALESCE(v_shelf, 0) > 0 THEN
      v_expiry := (NEW.created_at AT TIME ZONE 'Asia/Jakarta')::date + v_shelf;
    END IF;
  END IF;

  INSERT INTO inventory.stock_batches (
    inventory_id, raw_material_id, warehouse_id, branch_id, batch_number, expiry_date,
    qty_received, qty_remaining, unit_cost, received_at, source_type,
    source_reference_id, source_movement_id
  ) VALUES (
    NEW.inventory_id, NEW.raw_material_id, COALESCE(NEW.warehouse_id, v_inv.warehouse_id),
    COALESCE(NEW.branch_id, v_inv.branch_id), NULLIF(btrim(NEW.batch_number), ''), v_expiry,
    v_delta, v_delta, COALESCE(NEW.unit_cost, 0), NEW.created_at,
    COALESCE(NEW.reference_type, 'movement'), NEW.reference_id, NEW.id
  ) RETURNING id INTO v_new_id;
  INSERT INTO inventory.stock_batch_movements (batch_id, movement_id, qty, qty_before, qty_after)
  VALUES (v_new_id, NEW.id, v_delta, 0, v_delta);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_movement_batches ON inventory.inventory_movements;
CREATE TRIGGER trg_inventory_movement_batches
  AFTER INSERT ON inventory.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION inventory.fn_inventory_movement_batches();

-- Saldo yang sudah ada sebelum fitur batch: satu batch "saldo awal" tanpa tanggal.
INSERT INTO inventory.stock_batches (
  inventory_id, raw_material_id, warehouse_id, branch_id, batch_number, expiry_date,
  qty_received, qty_remaining, unit_cost, received_at, source_type
)
SELECT i.id, i.raw_material_id, i.warehouse_id, i.branch_id, NULL, NULL,
       i.qty_available, i.qty_available, COALESCE(i.unit_cost, 0),
       COALESCE(i.last_movement_at, i.created_at), 'opening'
  FROM inventory.inventory i
 WHERE i.qty_available > 0
   AND NOT EXISTS (SELECT 1 FROM inventory.stock_batches b WHERE b.inventory_id = i.id);

-- 2. Audit trail ----------------------------------------------------------------
-- configuration.activity_logs tidak dipakai: kolomnya candidate_id NOT NULL
-- (log rekrutmen), tanpa actor/before/after. Audit butuh tabel sendiri.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid,
  actor_name   text,
  action       varchar(60) NOT NULL,
  entity       varchar(60) NOT NULL,
  entity_id    text,
  entity_label text,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit.audit_log IS
  'Jejak audit append-only: siapa mengubah apa. Ditulis lewat recordAudit() dalam transaksi aksi. UPDATE/DELETE/TRUNCATE ditolak trigger.';

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit.audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit.audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit.audit_log (action);

CREATE OR REPLACE FUNCTION audit.fn_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log bersifat append-only (% ditolak)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit.audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_append_only();

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit.audit_log;
CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.fn_audit_log_append_only();

-- 3. Kemasan (pack) -------------------------------------------------------------
-- item.raw_material_unit_conversions sudah menyimpan "satuan X = n satuan dasar"
-- dan dipakai konversi GRN; tabel ini menjadi tabel pack.

ALTER TABLE item.raw_material_unit_conversions
  ADD COLUMN IF NOT EXISTS barcode varchar(64),
  ADD COLUMN IF NOT EXISTS is_purchase_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_issue_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN item.raw_material_unit_conversions.qty_in_base_unit IS
  'Isi pack dalam satuan dasar stok (satuan kecil bila ada, selain itu satuan besar). Pack dasar = 1.';
COMMENT ON COLUMN item.raw_material_unit_conversions.is_purchase_default IS
  'Pack bawaan baris PO baru.';
COMMENT ON COLUMN item.raw_material_unit_conversions.is_issue_default IS
  'Pack bawaan pengeluaran/pemakaian stok.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_rm_pack_purchase_default
  ON item.raw_material_unit_conversions (raw_material_id)
  WHERE is_purchase_default AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rm_pack_issue_default
  ON item.raw_material_unit_conversions (raw_material_id)
  WHERE is_issue_default AND is_active;

-- Satuan kecil (dasar, isi 1).
INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
SELECT rm.id, rm.satuan_kecil_id, 1, true, true
  FROM item.raw_materials rm
 WHERE rm.satuan_kecil_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM item.raw_material_unit_conversions c
      WHERE c.raw_material_id = rm.id AND c.satuan_id = rm.satuan_kecil_id);

-- Satuan besar: isi = konversi_factor bila ada satuan kecil, selain itu dasar (1).
INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
SELECT rm.id, rm.satuan_besar_id,
       CASE WHEN rm.satuan_kecil_id IS NOT NULL AND rm.satuan_kecil_id <> rm.satuan_besar_id
            THEN COALESCE(NULLIF(rm.konversi_factor, 0), 1) ELSE 1 END,
       rm.satuan_kecil_id IS NULL OR rm.satuan_kecil_id = rm.satuan_besar_id,
       true
  FROM item.raw_materials rm
 WHERE rm.satuan_besar_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM item.raw_material_unit_conversions c
      WHERE c.raw_material_id = rm.id AND c.satuan_id = rm.satuan_besar_id);

-- Bawaan: beli dalam satuan besar, keluarkan dalam satuan dasar.
UPDATE item.raw_material_unit_conversions c
   SET is_purchase_default = true, updated_at = now()
  FROM item.raw_materials rm
 WHERE rm.id = c.raw_material_id
   AND c.satuan_id = rm.satuan_besar_id
   AND c.is_active
   AND NOT EXISTS (
     SELECT 1 FROM item.raw_material_unit_conversions d
      WHERE d.raw_material_id = c.raw_material_id AND d.is_purchase_default AND d.is_active);

UPDATE item.raw_material_unit_conversions c
   SET is_issue_default = true, updated_at = now()
 WHERE c.is_base
   AND c.is_active
   AND NOT EXISTS (
     SELECT 1 FROM item.raw_material_unit_conversions d
      WHERE d.raw_material_id = c.raw_material_id AND d.is_issue_default AND d.is_active);

-- 4. Retur, AP, kredit vendor -------------------------------------------------

ALTER TABLE purchasing.purchase_returns
  ADD COLUMN IF NOT EXISTS revision_no integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision_of uuid REFERENCES purchasing.purchase_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES purchasing.purchase_returns(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchasing.purchase_returns.revision_of IS
  'Retur yang ditolak dan direvisi menjadi dokumen ini (riwayat tetap utuh).';

CREATE INDEX IF NOT EXISTS idx_purchase_returns_revision_of ON purchasing.purchase_returns (revision_of);

ALTER TABLE accounting.ap_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE purchasing.vendor_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE purchasing.vendor_credits
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS applied_amount numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_credits_applied_amount_check'
  ) THEN
    ALTER TABLE purchasing.vendor_credits
      ADD CONSTRAINT vendor_credits_applied_amount_check
      CHECK (applied_amount >= 0 AND applied_amount <= total_amount + 0.01);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS purchasing.vendor_credit_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_credit_id  uuid NOT NULL REFERENCES purchasing.vendor_credits(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchasing.purchase_orders(id) ON DELETE CASCADE,
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  applied_by        uuid,
  applied_at        timestamptz NOT NULL DEFAULT now(),
  voided_at         timestamptz,
  voided_by         uuid,
  void_reason       text
);

COMMENT ON TABLE purchasing.vendor_credit_applications IS
  'Pemakaian kredit vendor ke PO (tertua lebih dulu, kredit kedaluwarsa dilewati).';

CREATE INDEX IF NOT EXISTS idx_vca_credit ON purchasing.vendor_credit_applications (vendor_credit_id);
CREATE INDEX IF NOT EXISTS idx_vca_po ON purchasing.vendor_credit_applications (purchase_order_id) WHERE voided_at IS NULL;

-- 5. Menu IAM ---------------------------------------------------------------------

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.raw-material.inventory.movements', 'Mutasi Stok', '/dashboard/inventory/movements', 'document-magnifying-glass', 'sidebar', 50, '{"actions":["read"]}'::jsonb),
  ('items.raw-material.inventory.expiry', 'Stok Kedaluwarsa', '/dashboard/inventory/expiry', 'clock', 'sidebar', 60, '{"actions":["read","create"]}'::jsonb),
  ('items.raw-material.inventory.scrap', 'Scrap & Write-off', '/dashboard/inventory/scrap', 'package', 'sidebar', 70, '{"actions":["read","create"]}'::jsonb),
  ('settings.audit', 'Audit Trail', '/dashboard/settings/audit', 'document-text', 'sidebar', 45, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'items', level = 4
 WHERE code IN ('items.raw-material.inventory.movements', 'items.raw-material.inventory.expiry', 'items.raw-material.inventory.scrap');
UPDATE iam.menus SET module = 'settings', level = 2 WHERE code = 'settings.audit';

UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('items.raw-material.inventory.movements', 'items.raw-material.inventory.expiry', 'items.raw-material.inventory.scrap')
   AND parent.code = 'items.raw-material.inventory';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code = 'settings.audit' AND parent.code = 'settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'warehouse_admin', 'warehouse_staff', 'purchasing_admin', 'purchasing_manager')
   AND m.code IN ('items.raw-material.inventory.movements', 'items.raw-material.inventory.expiry', 'items.raw-material.inventory.scrap')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin', 'admin', 'direksi')
   AND m.code = 'settings.audit'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
