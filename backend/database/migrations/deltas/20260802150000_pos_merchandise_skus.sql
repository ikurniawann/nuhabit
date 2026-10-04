-- =============================================================================
-- EPIC-039 Fase B — varian merchandise ber-stok per SKU + multi-foto produk.
-- =============================================================================
-- Berbeda dari pos_product_variants (price-adjustment utk F&B), SKU merchandise
-- punya identitas sendiri: kode SKU, barcode, harga override, dan STOK sendiri.
-- Produk merchandise ber-varian menyimpan stok HANYA di baris SKU (stok produk
-- = SUM sku); pos_products.inventory_quantity hanya untuk produk tanpa varian.
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), dev.
-- =============================================================================

-- 1) Tabel SKU varian
CREATE TABLE IF NOT EXISTS pos.pos_product_skus (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    sku varchar(60) NOT NULL,
    name varchar(120) NOT NULL,
    options jsonb DEFAULT '{}'::jsonb,
    barcode varchar(64),
    price_override numeric(15,2),
    stock_quantity numeric(12,2) NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_product_skus_sku
  ON pos.pos_product_skus (lower(sku));
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_product_skus_barcode
  ON pos.pos_product_skus (barcode)
  WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_product_skus_product
  ON pos.pos_product_skus (product_id)
  WHERE is_active = true;

COMMENT ON TABLE pos.pos_product_skus IS
  'EPIC-039 Fase B — varian merchandise ber-stok per SKU (Merah/L dst). '
  'options jsonb bebas ({warna, ukuran}); price_override NULL = ikut '
  'base_price produk; stok produk ber-varian = SUM stock_quantity.';

-- 2) Multi-foto produk (dipakai storefront Fase D; diisi dari master)
CREATE TABLE IF NOT EXISTS pos.pos_product_images (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    url text NOT NULL,
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_product_images_product
  ON pos.pos_product_images (product_id, display_order);

-- 3) Jejak varian di baris order (restore stok saat void/cancel per SKU).
--    ON DELETE SET NULL: riwayat order tetap hidup walau SKU dihapus
--    (nama varian sudah snapshot di kolom variants/product_name).
ALTER TABLE pos.pos_order_items
  ADD COLUMN IF NOT EXISTS sku_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_order_items_sku_id_fkey'
  ) THEN
    ALTER TABLE pos.pos_order_items
      ADD CONSTRAINT pos_order_items_sku_id_fkey
      FOREIGN KEY (sku_id) REFERENCES pos.pos_product_skus(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Klaim/restore stok per SKU (pola pos_sell_merchandise_stock Fase A).
--    Guard allow_negative_stock ikut setting PRODUK induk (satu kebijakan
--    per produk, bukan per varian). p_qty negatif = restore tanpa guard.
CREATE OR REPLACE FUNCTION public.pos_sell_merchandise_sku_stock(
  p_sku_id uuid,
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
    UPDATE pos.pos_product_skus
    SET stock_quantity = COALESCE(stock_quantity, 0) - p_qty,
        updated_at = now()
    WHERE id = p_sku_id
    RETURNING id, stock_quantity INTO v_row;

    RETURN jsonb_build_object(
      'success', v_row.id IS NOT NULL,
      'restored', true,
      'quantity_after', v_row.stock_quantity
    );
  END IF;

  UPDATE pos.pos_product_skus s
  SET stock_quantity = COALESCE(s.stock_quantity, 0) - p_qty,
      updated_at = now()
  WHERE s.id = p_sku_id
    AND s.is_active = true
    AND (
      COALESCE(s.stock_quantity, 0) >= p_qty
      OR COALESCE(
        (SELECT st.allow_negative_stock
         FROM pos.pos_inventory_settings st
         WHERE st.product_id = s.product_id),
        true
      )
    )
  RETURNING s.id, s.stock_quantity INTO v_row;

  IF v_row.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM pos.pos_product_skus WHERE id = p_sku_id AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'reason', 'insufficient_stock');
    END IF;
    RETURN jsonb_build_object('success', false, 'reason', 'sku_not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'quantity_after', v_row.stock_quantity);
END;
$function$;

-- 5) Produk ber-varian WAJIB memilih SKU: fungsi product-level Fase A kini
--    menolak klaim positif bila produk punya SKU aktif (variant_required).
--    Restore (qty negatif) tetap lewat — kompensasi baris lama tanpa varian.
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

  -- EPIC-039 Fase B — varian aktif ada → stok hidup di SKU, bukan produk
  IF EXISTS (
    SELECT 1 FROM pos.pos_product_skus
    WHERE product_id = p_product_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'variant_required');
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

-- 6) GRN receive Fase A: JANGAN menambah stok product-level bila produk
--    ber-varian (GRN purchasing tidak kenal dimensi varian — stok varian
--    masuk via koreksi per SKU di master; per-varian GRN = fase lanjut).
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

  UPDATE pos.pos_products p
  SET inventory_quantity = COALESCE(p.inventory_quantity, 0) + p_qty,
      updated_at = now()
  WHERE p.source_product_id = p_source_product_id
    AND p.product_kind = 'merchandise'
    AND p.inventory_tracking = true
    AND NOT EXISTS (
      SELECT 1 FROM pos.pos_product_skus s
      WHERE s.product_id = p.id AND s.is_active = true
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
