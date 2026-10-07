import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { scopeSqlFilters, xlsxDownload } from "@/lib/purchasing/export-scope";
import { buildSupplierWorkbookBuffer } from "@/lib/purchasing/supplier-spreadsheet";

type ExportRow = {
  kode: string;
  nama_supplier: string;
  pic_name: string | null;
  pic_phone: string | null;
  pic_email: string | null;
  telepon: string | null;
  email: string | null;
  alamat: string | null;
  kota: string | null;
  npwp: string | null;
  payment_terms: string;
  currency: string;
  bank_nama: string | null;
  bank_rekening: string | null;
  bank_atas_nama: string | null;
  kategori: string | null;
  catatan: string | null;
  status: string;
};

// GET /api/purchasing/export/suppliers — .xlsx sesuai kolom impor supplier
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const { filters, params } = scopeSqlFilters(await getApiUserScope(), "s");

  const rows = await query<ExportRow>(
    `SELECT
       s.kode,
       s.nama_supplier,
       s.pic_name,
       s.pic_phone,
       s.pic_email,
       s.telepon,
       s.email,
       s.alamat,
       s.kota,
       s.npwp,
       COALESCE(s.payment_terms, 'TOP30') AS payment_terms,
       COALESCE(s.currency, 'IDR') AS currency,
       s.bank_nama,
       s.bank_rekening,
       s.bank_atas_nama,
       s.kategori,
       s.catatan,
       COALESCE(s.status, 'active') AS status
     FROM purchasing.suppliers s
     WHERE ${filters.join(" AND ")}
     ORDER BY s.nama_supplier ASC`,
    params
  );

  return xlsxDownload(await buildSupplierWorkbookBuffer(rows), "suppliers");
}, "purchasing.export.suppliers");
