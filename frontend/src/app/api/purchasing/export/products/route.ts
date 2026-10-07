import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { scopeSqlFilters, xlsxDownload } from "@/lib/purchasing/export-scope";
import { buildProductWorkbookBuffer } from "@/lib/purchasing/product-spreadsheet";

type ExportRow = {
  kode: string;
  nama: string;
  stall_code: string | null;
  kategori: string | null;
  satuan_kode: string | null;
  deskripsi: string | null;
  harga_jual: string | number;
  harga_modal: string | number;
  markup_persen: string | number;
  production_output_type: string;
  status: string;
};

// GET /api/purchasing/export/products — .xlsx sesuai kolom impor produk
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const { filters, params } = scopeSqlFilters(await getApiUserScope(), "p");

  const rows = await query<ExportRow>(
    `SELECT
       p.kode,
       p.nama,
       wh.code AS stall_code,
       p.kategori,
       u.kode AS satuan_kode,
       p.deskripsi,
       COALESCE(p.harga_jual, 0) AS harga_jual,
       COALESCE(p.harga_modal, 0) AS harga_modal,
       COALESCE(p.markup_persen, 30) AS markup_persen,
       COALESCE(p.production_output_type, 'FINISHED_GOOD') AS production_output_type,
       CASE WHEN COALESCE(p.is_active, true) THEN 'active' ELSE 'inactive' END AS status
     FROM item.products p
     LEFT JOIN item.units u ON u.id = p.satuan_id
     LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
     WHERE ${filters.join(" AND ")}
     ORDER BY wh.code ASC, p.nama ASC`,
    params
  );

  return xlsxDownload(await buildProductWorkbookBuffer(rows), "products");
}, "purchasing.export.products");
