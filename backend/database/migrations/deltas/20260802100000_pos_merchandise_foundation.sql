-- =============================================================================
-- EPIC-039 Fase A — Fondasi merchandise di katalog POS.
-- =============================================================================
-- Keputusan arsitektur (Automation Log EPIC-039, 2 Agu):
--   * Merchandise = product_kind BARU di pos_products (preseden gift_card),
--     BUKAN jalur F&B (tanpa BOM/pos_recipes) dan BUKAN module_type purchasing
--     baru — pembelian reuse jalur module_type='product' + item.products.
--   * Seam purchasing→POS ditutup dengan FK source_product_id (disebut docs
--     EPIC-027 tapi belum pernah dimigrasikan; selama ini hanya soft-sync SKU
--     string PUR-<kode>).
--   * Stok merchandise = pos_products.inventory_quantity (flat, tanpa BOM);
--     varian ber-stok per SKU menyusul di Fase B.
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), dev.
-- =============================================================================

-- 1) product_kind += 'merchandise' (lebarkan CHECK gift_card EPIC-034)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_products_product_kind_check'
  ) THEN
    ALTER TABLE pos.pos_products
      DROP CONSTRAINT pos_products_product_kind_check;
  END IF;

  ALTER TABLE pos.pos_products
    ADD CONSTRAINT pos_products_product_kind_check
    CHECK (product_kind IN ('regular', 'gift_card', 'merchandise'));
END $$;

COMMENT ON COLUMN pos.pos_products.product_kind IS
  'regular = produk jualan biasa; gift_card = saldo titipan (EPIC-034); '
  'merchandise = barang beli-jadi-jual tanpa BOM, stok flat per produk, '
  'dibeli via purchasing module_type=product (EPIC-039 Fase A).';

-- 2) Tautan resmi ke master purchasing (item.products) — pengganti soft-sync
--    SKU PUR-<kode>. UNIQUE partial: satu item purchasing hanya boleh
--    tertaut ke satu produk POS, agar posting stok GRN tidak dobel.
ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS source_product_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_products_source_product_id_fkey'
  ) THEN
    ALTER TABLE pos.pos_products
      ADD CONSTRAINT pos_products_source_product_id_fkey
      FOREIGN KEY (source_product_id) REFERENCES item.products(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_products_source_product
  ON pos.pos_products (source_product_id)
  WHERE source_product_id IS NOT NULL;

COMMENT ON COLUMN pos.pos_products.source_product_id IS
  'FK ke item.products — GRN purchasing jalur product menambah '
  'inventory_quantity produk POS yang tertaut (EPIC-039 Fase A).';

-- 3) Atribut merchandise/e-commerce (dipakai Fase C ongkir & Fase D storefront;
--    disiapkan sekarang agar master produk cukup diisi sekali)
ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS weight_gram numeric(10,2),
  ADD COLUMN IF NOT EXISTS length_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS width_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS height_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS long_description text;

-- 4) Posting stok dari GRN (dipanggil route GRN utk module_type='product').
--    Atomik satu statement; hanya menyentuh produk merchandise yang tertaut
--    dan ber-inventory_tracking. RETURNS jumlah baris terdampak (0 = tidak
--    ada produk POS tertaut — caller mencatat warning, non-fatal).
CREATE OR REPLACE FUNCTION public.pos_receive_merchandise_stock(
  p_source_product_id uuid,
  p_qty numeric
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE pos.pos_products
  SET inventory_quantity = COALESCE(inventory_quantity, 0) + p_qty,
      updated_at = now()
  WHERE source_product_id = p_source_product_id
    AND product_kind = 'merchandise'
    AND inventory_tracking = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

-- 5) Klaim stok saat kasir menjual (klaim-dulu, pola gift card/ARK Coin).
--    Decrement atomik dalam satu UPDATE ber-guard: cukup stok ATAU
--    allow_negative_stock (baris pos_inventory_settings tidak ada =
--    ikut default kolom, yaitu boleh minus — kasir tidak pernah terblokir
--    tanpa konfigurasi eksplisit). p_qty negatif dipakai utk kompensasi/
--    restore (tanpa guard saldo).
CREATE OR REPLACE FUNCTION public.pos_sell_merchandise_stock(
  p_product_id uuid,
  p_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_row record;
BEGIN
  IF p_qty IS NULL OR p_qty = 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF p_qty < 0 THEN
    -- Restore/kompensasi: kembalikan stok tanpa guard.
    UPDATE pos.pos_products
    SET inventory_quantity = COALESCE(inventory_quantity, 0) - p_qty,
        updated_at = now()
    WHERE id = p_product_id
      AND product_kind = 'merchandise'
      AND inventory_tracking = true
    RETURNING id, inventory_quantity INTO v_row;

    RETURN jsonb_build_object(
      'success', v_row.id IS NOT NULL,
      'restored', true,
      'quantity_after', v_row.inventory_quantity
    );
  END IF;

  UPDATE pos.pos_products p
  SET inventory_quantity = COALESCE(p.inventory_quantity, 0) - p_qty,
      updated_at = now()
  WHERE p.id = p_product_id
    AND p.product_kind = 'merchandise'
    AND p.inventory_tracking = true
    AND (
      COALESCE(p.inventory_quantity, 0) >= p_qty
      OR COALESCE(
        (SELECT s.allow_negative_stock
         FROM pos.pos_inventory_settings s
         WHERE s.product_id = p.id),
        true
      )
    )
  RETURNING p.id, p.inventory_quantity INTO v_row;

  IF v_row.id IS NULL THEN
    -- Bedakan "bukan produk ber-stok" (bukan error) vs "stok tidak cukup".
    IF EXISTS (
      SELECT 1 FROM pos.pos_products
      WHERE id = p_product_id
        AND product_kind = 'merchandise'
        AND inventory_tracking = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'reason', 'insufficient_stock');
    END IF;
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'quantity_after', v_row.inventory_quantity);
END;
$function$;

-- 6) Seed kategori induk "Merchandise" (hierarki pos_categories sudah ada)
INSERT INTO pos.pos_categories (name, is_active, display_order)
SELECT 'Merchandise', true, 90
WHERE NOT EXISTS (
  SELECT 1 FROM pos.pos_categories WHERE lower(name) = 'merchandise'
);
