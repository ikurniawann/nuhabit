import { PRODUCT_IMPORT_COLUMNS } from "@/lib/purchasing/import-columns";
import { buildSingleSheetWorkbook, createHeaderNormalizer } from "@/lib/purchasing/import-spreadsheet";

const HEADERS = PRODUCT_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  product_code: "kode",
  kode_produk: "kode",
  name: "nama",
  product_name: "nama",
  nama_produk: "nama",
  category: "kategori",
  category_code: "kategori",
  unit: "satuan_kode",
  unit_code: "satuan_kode",
  satuan: "satuan_kode",
  description: "deskripsi",
  notes: "deskripsi",
  selling_price: "harga_jual",
  price: "harga_jual",
  cost_price: "harga_modal",
  cost: "harga_modal",
  markup: "markup_persen",
  markup_percent: "markup_persen",
  output_type: "production_output_type",
  production_type: "production_output_type",
  stall: "stall_code",
  stall_code: "stall_code",
  warehouse: "stall_code",
  warehouse_code: "stall_code",
};

export const normalizeProductSpreadsheetHeader = createHeaderNormalizer(HEADER_ALIASES);

/** Buffer .xlsx ekspor Products (ExcelJS). */
export function buildProductWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  return buildSingleSheetWorkbook("Products", HEADERS, rows);
}

