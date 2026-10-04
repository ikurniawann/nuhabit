import { SUPPLIER_IMPORT_COLUMNS } from "@/lib/purchasing/import-columns";
import { buildSingleSheetWorkbook, createHeaderNormalizer } from "@/lib/purchasing/import-spreadsheet";

const HEADERS = SUPPLIER_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  supplier_code: "kode",
  nama: "nama_supplier",
  name: "nama_supplier",
  supplier_name: "nama_supplier",
  contact_person: "pic_name",
  nama_pic: "pic_name",
  contact_phone: "pic_phone",
  telepon_pic: "pic_phone",
  contact_email: "pic_email",
  email_pic: "pic_email",
  phone: "telepon",
  company_phone: "telepon",
  company_email: "email",
  address: "alamat",
  city: "kota",
  tax_id: "npwp",
  payment_term: "payment_terms",
  termin_pembayaran: "payment_terms",
  mata_uang: "currency",
  bank_name: "bank_nama",
  bank_account: "bank_rekening",
  no_rekening: "bank_rekening",
  account_holder: "bank_atas_nama",
  atas_nama: "bank_atas_nama",
  category: "kategori",
  notes: "catatan",
  description: "catatan",
  deskripsi: "catatan",
};

export const normalizeSupplierSpreadsheetHeader = createHeaderNormalizer(HEADER_ALIASES);

/** Buffer .xlsx ekspor Suppliers (ExcelJS). */
export function buildSupplierWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  return buildSingleSheetWorkbook("Suppliers", HEADERS, rows);
}

