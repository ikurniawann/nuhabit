import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { ApiError, paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { suggestReorder } from "@/lib/inventory/reorder";

type LowStockRow = {
  id: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  material_kategori: string | null;
  qty_available: number;
  qty_on_order: number;
  qty_minimum: number;
  qty_maximum: number | null;
  unit_cost: number;
  /** Satuan dasar stok (qty_* dalam satuan ini). */
  satuan: string | null;
  stock_status: "out_of_stock" | "low_stock";
  warehouse_nama: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  last_purchase_date: string | null;
};

/**
 * GET /api/inventory/low-stock — stok di bawah minimum + saran order.
 * Saran order: sampai stok maksimum (stok di tangan + yang sudah dipesan
 * dikurangkan); tanpa maksimum memakai aturan lama (kekurangan x 1,5).
 * Maksimum diambil dari inventory.qty_maximum lalu raw_materials.stok_maximum;
 * v_inventory tidak dipakai karena mengisi maksimum kosong dengan 10000.
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || "";

    const rows = await query<LowStockRow>(
      `WITH levels AS (
         SELECT inv.id, inv.raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama,
                rm.kategori AS material_kategori,
                inv.qty_available::float8 AS qty_available,
                inv.qty_on_order::float8 AS qty_on_order,
                COALESCE(rm.stok_minimum, inv.qty_minimum, 1000)::float8 AS qty_minimum,
                COALESCE(NULLIF(inv.qty_maximum, 0), NULLIF(rm.stok_maximum, 0))::float8 AS qty_maximum,
                COALESCE(inv.unit_cost, 0)::float8 AS unit_cost,
                COALESCE(u_kecil.nama, u_besar.nama) AS satuan, w.name AS warehouse_nama
           FROM inventory.inventory inv
           JOIN item.raw_materials rm ON rm.id = inv.raw_material_id
           LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
           LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
           LEFT JOIN configuration.warehouses w ON w.id = inv.warehouse_id
          WHERE inv.is_active = true
            AND ($1::text = '' OR $1 = 'all' OR rm.kategori = $1)
       )
       SELECT l.*,
              CASE WHEN l.qty_available <= 0 THEN 'out_of_stock' ELSE 'low_stock' END AS stock_status,
              last_po.supplier_id, last_po.supplier_name, last_po.tanggal_po AS last_purchase_date
         FROM levels l
         LEFT JOIN LATERAL (
           SELECT po.supplier_id, s.nama_supplier AS supplier_name, po.tanggal_po::text AS tanggal_po
             FROM purchasing.purchase_order_items poi
             JOIN purchasing.purchase_orders po ON po.id = poi.purchase_order_id
             LEFT JOIN purchasing.suppliers s ON s.id = po.supplier_id
            WHERE poi.raw_material_id = l.raw_material_id AND po.supplier_id IS NOT NULL
            ORDER BY po.tanggal_po DESC, po.created_at DESC
            LIMIT 1
         ) last_po ON true
        WHERE l.qty_available <= l.qty_minimum
          AND ($2::text = '' OR ($2 = 'out_of_stock' AND l.qty_available <= 0)
               OR ($2 = 'low_stock' AND l.qty_available > 0))
        ORDER BY l.qty_available ASC`,
      [category, status]
    );

    const data = rows.map((row) => {
      const suggestion = suggestReorder({
        onHand: row.qty_available,
        onOrder: row.qty_on_order,
        minimum: row.qty_minimum,
        maximum: row.qty_maximum,
      });
      return {
        id: row.id,
        raw_material_id: row.raw_material_id,
        material_kode: row.material_kode,
        material_nama: row.material_nama,
        kategori: row.material_kategori,
        qty_available: row.qty_available,
        qty_on_order: row.qty_on_order,
        qty_minimum: row.qty_minimum,
        qty_maximum: row.qty_maximum,
        unit_cost: row.unit_cost,
        satuan: row.satuan,
        warehouse_nama: row.warehouse_nama,
        stock_status: row.stock_status,
        shortage_qty: suggestion.shortage,
        suggested_order_qty: suggestion.suggestedQty,
        suggestion_basis: suggestion.basis,
        estimated_cost: suggestion.suggestedQty * row.unit_cost,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name ?? undefined,
        last_purchase_date: row.last_purchase_date ?? undefined,
      };
    });

    return paginatedResponse(data, { page: 1, limit: data.length, total: data.length }, "Low stock report retrieved");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching low stock report:", error);
    return Response.json({ success: false, error: "Gagal memuat laporan stok rendah" }, { status: 500 });
  }
}
