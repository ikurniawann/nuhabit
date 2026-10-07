import { RAW_MATERIAL_IMPORT_COLUMNS } from "@/lib/purchasing/import-columns";
import { buildSingleSheetWorkbook, createHeaderNormalizer } from "@/lib/purchasing/import-spreadsheet";

const HEADERS = RAW_MATERIAL_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  name: "nama",
  category: "kategori",
  category_code: "kategori",
  purchase_unit: "satuan_besar_kode",
  satuan_pembelian: "satuan_besar_kode",
  large_unit_code: "satuan_besar_kode",
  usage_unit: "satuan_kecil_kode",
  satuan_penggunaan: "satuan_kecil_kode",
  small_unit_code: "satuan_kecil_kode",
  conversion_factor: "konversi_factor",
  qty_per_unit: "konversi_factor",
  minimum_stock: "stok_minimum",
  maximum_stock: "stok_maximum",
  stok_maksimum: "stok_maximum",
  "shelf_life_(days)": "shelf_life_days",
  shelf_life_days: "shelf_life_days",
  masa_simpan: "shelf_life_days",
  purchase_price: "harga_beli",
  harga_rata_rata: "harga_beli",
  description: "deskripsi",
  opening_stock: "opening_stock",
  initial_stock: "opening_stock",
  stok_awal: "opening_stock",
  qty_onhand: "opening_stock",
  stall_code: "stall_code",
  warehouse_code: "stall_code",
  warehouse_kode: "stall_code",
  gudang_kode: "stall_code",
};

export const normalizeSpreadsheetHeader = createHeaderNormalizer(HEADER_ALIASES);

/** Buffer .xlsx ekspor Raw Materials (ExcelJS). */
export function buildRawMaterialWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  return buildSingleSheetWorkbook("Raw Materials", HEADERS, rows);
}

