-- Pengaman stok negatif — dipindahkan dari migrations/010_pos_product_inventory.sql
-- (2026-09-14) sebelum folder legacy dihapus. Folder itu tidak pernah dibaca
-- database/scripts/apply-migrations.js, jadi pengaman ini tidak pernah terpasang
-- di deploy baru.
--
-- Perilakunya menjepit, bukan menolak: update yang membuat inventory_quantity
-- negatif dibulatkan ke 0 agar stok tidak pernah tampil minus. Berlaku hanya
-- untuk produk yang stoknya dilacak (inventory_tracking = true).
--
-- Catatan: tabel kini berada di skema `pos` (dulu tanpa skema), jadi referensi
-- disesuaikan.

CREATE OR REPLACE FUNCTION pos.pos_prevent_negative_inventory()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.inventory_tracking = true
     AND NEW.inventory_quantity IS NOT NULL
     AND NEW.inventory_quantity < 0 THEN
    NEW.inventory_quantity := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_products_prevent_negative ON pos.pos_products;
CREATE TRIGGER trg_pos_products_prevent_negative
  BEFORE UPDATE ON pos.pos_products
  FOR EACH ROW
  EXECUTE FUNCTION pos.pos_prevent_negative_inventory();
