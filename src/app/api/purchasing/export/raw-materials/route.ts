import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { getApiStallScope } from "@/lib/api/stall-scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { scopeSqlFilters, xlsxDownload } from "@/lib/purchasing/export-scope";
import { buildRawMaterialWorkbookBuffer } from "@/lib/purchasing/raw-material-spreadsheet";

type ExportRow = {
  kode: string;
  nama: string;
  kategori: string;
  satuan_besar_kode: string | null;
  satuan_kecil_kode: string | null;
  konversi_factor: number | string | null;
  stok_minimum: number | string | null;
  stok_maximum: number | string | null;
  shelf_life_days: number | string | null;
  coa: string | null;
  harga_beli: number | string;
  opening_stock: number | string;
  stall_code: string;
  deskripsi: string | null;
  status: string;
};

// GET /api/purchasing/export/raw-materials — .xlsx sesuai kolom impor bahan baku
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const { filters, params } = scopeSqlFilters(await getApiUserScope(), "rm");

  // Stok awal mengikuti stall aktif di sidebar agar isi file sama dengan tabel
  // yang dilihat. "Semua Stall" memakai gudang default cabang (`is_default`),
  // bukan kode 'MAIN' yang tidak ada di setiap cabang (file jadi gagal diimpor balik).
  const stallScope = await getApiStallScope();
  let warehouseJoin = `wh.branch_id = rm.branch_id
      AND wh.is_default = true
      AND wh.is_active = true`;
  if (stallScope.mode === "stall") {
    params.push(stallScope.warehouseId);
    warehouseJoin = `wh.id = $${params.length}
      AND wh.is_active = true`;
  }

  const rows = await query<ExportRow>(
    `SELECT
       rm.kode,
       rm.nama,
       rm.kategori,
       ub.kode AS satuan_besar_kode,
       uk.kode AS satuan_kecil_kode,
       rm.konversi_factor,
       rm.stok_minimum,
       rm.stok_maximum,
       rm.shelf_life_days,
       rm.coa,
       COALESCE(rm.harga_beli, 0) AS harga_beli,
       COALESCE(inv.qty_available, 0) AS opening_stock,
       -- Kosong bila cabang tidak punya gudang default; impor me-resolve lokasinya sendiri.
       COALESCE(wh.code, '') AS stall_code,
       rm.deskripsi,
       CASE WHEN rm.is_active THEN 'active' ELSE 'inactive' END AS status
     FROM item.raw_materials rm
     LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
     LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
     LEFT JOIN configuration.warehouses wh
       ON ${warehouseJoin}
     LEFT JOIN inventory.inventory inv
       ON inv.raw_material_id = rm.id
      AND inv.warehouse_id = wh.id
      AND inv.is_active = true
     WHERE ${filters.join(" AND ")}
     ORDER BY rm.nama ASC`,
    params
  );

  const buffer = await buildRawMaterialWorkbookBuffer(
    rows.map((row) => ({
      ...row,
      konversi_factor: row.konversi_factor ?? 1,
      stok_minimum: row.stok_minimum ?? 0,
    }))
  );
  return xlsxDownload(buffer, "raw-materials");
}, "purchasing.export.raw-materials");
