import { createPgClient } from "@/lib/pg/create-client";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { PrintFloatingButton } from "@/features/purchasing/print/components/print-floating-button";
import { PrintDocumentTitle } from "@/features/purchasing/print/components/print-document-title";
import { PrintDocumentStyles } from "@/features/purchasing/print/components/print-document-styles";

type PrintPOItem = {
  id: string;
  qty_ordered: number;
  harga_satuan: number;
  subtotal: number;
  catatan?: string | null;
  raw_material?: { kode?: string; nama?: string } | null;
  satuan?: { nama?: string } | null;
};

type PrintPORow = {
  id: string;
  nomor_po: string;
  tanggal_po?: string | null;
  tanggal_kirim_estimasi?: string | null;
  alamat_pengiriman?: string | null;
  catatan?: string | null;
  subtotal?: number | null;
  diskon_persen?: number | null;
  diskon_nominal?: number | null;
  ppn_persen?: number | null;
  ppn_nominal?: number | null;
  grand_total?: number | null;
  total?: number | null;
  nama_supplier?: string | null;
  supplier_kode?: string | null;
  pr?: { pr_number?: string | null } | null;
  supplier?: {
    kode?: string | null;
    kode_supplier?: string | null;
    nama_supplier?: string | null;
    alamat?: string | null;
    pic_name?: string | null;
    telepon?: string | null;
    email?: string | null;
  } | null;
  items?: PrintPOItem[];
};

interface PrintPOPageProps {
  params: Promise<{ id: string }>;
}

export async function PrintPOPage({ params }: PrintPOPageProps) {
  const { id } = await params;
  const db = createPgClient();

  const { data: po } = await db
    .from("v_purchase_orders")
    .select("*")
    .eq("id", id)
    .single();

  if (!po) {
    notFound();
  }

  const poData = po as PrintPORow;

  const { data: itemsData } = await db
    .from("purchase_order_items")
    .select(`
      *,
      raw_material:raw_materials!raw_material_id(kode, nama),
      satuan:units!satuan_id(nama)
    `)
    .eq("purchase_order_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const items = (itemsData || []) as PrintPOItem[];
  const subtotalFromItems = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const subtotal = Number(poData.subtotal || subtotalFromItems || 0);
  const discount = Number(poData.diskon_nominal || 0);
  const taxPercent = Number(poData.ppn_persen || 0);
  const taxAmount = Number(poData.ppn_nominal || Math.round((subtotal - discount) * taxPercent / 100) || 0);
  const total = Number(poData.grand_total || poData.total || subtotal - discount + taxAmount || 0);
  const supplierCode = poData.supplier_kode || poData.supplier?.kode_supplier || poData.supplier?.kode || "-";
  const supplierName = poData.nama_supplier || poData.supplier?.nama_supplier || "-";
  const printTitle = `Purchase Order - ${poData.nomor_po}`;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 print:min-h-0 print:bg-white print:p-0">
      <PrintDocumentTitle title={printTitle} />
      <PrintDocumentStyles />

      <main className="print-root print-sheet mx-auto max-w-5xl rounded-2xl border border-gray-200/70 bg-white p-8 shadow-sm">
        <div className="print-keep mb-6 flex items-start justify-between gap-6 border-b border-gray-200/70 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-600">
              Purchase Order
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">Pesanan Pembelian</h1>
            <p className="mt-1 text-sm text-gray-500">Dokumen pemesanan pembelian ke supplier</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">No. PO</p>
            <p className="text-xl font-bold text-gray-900">{poData.nomor_po}</p>
            <p className="mt-1 text-sm text-gray-500">Tanggal: {formatDate(poData.tanggal_po)}</p>
          </div>
        </div>

        <section className="print-keep mb-6 grid grid-cols-1 gap-4 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Supplier</h2>
            <p className="mt-2 text-base font-bold text-gray-900">{supplierName}</p>
            <p className="text-xs text-gray-500">{supplierCode}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{poData.supplier?.alamat || "-"}</p>
            <div className="mt-2 text-sm text-gray-600">
              <p>Attn: {poData.supplier?.pic_name || "-"}</p>
              <p>Telp: {poData.supplier?.telepon || "-"}</p>
              <p>Email: {poData.supplier?.email || "-"}</p>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Detail Dokumen</h2>
            <div className="mt-2 grid gap-2 text-sm">
              <div>
                <p className="text-xs text-gray-500">Dari</p>
                <p className="font-semibold text-gray-900">Aapex Technology</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Estimasi Pengiriman</p>
                <p className="font-medium text-gray-900">{formatDate(poData.tanggal_kirim_estimasi)}</p>
              </div>
              {poData.pr?.pr_number && (
                <div>
                  <p className="text-xs text-gray-500">Referensi PR</p>
                  <p className="font-medium text-gray-900">{poData.pr.pr_number}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="print-table-wrap mb-6 overflow-hidden rounded-xl border border-gray-200/70">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200/70">
                <th className="w-12 px-3 py-3 text-left text-xs font-semibold text-gray-700">No</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">Deskripsi Barang/Jasa</th>
                <th className="w-20 px-3 py-3 text-center text-xs font-semibold text-gray-700">Qty</th>
                <th className="w-24 px-3 py-3 text-center text-xs font-semibold text-gray-700">Satuan</th>
                <th className="w-32 px-3 py-3 text-right text-xs font-semibold text-gray-700">Harga</th>
                <th className="w-32 px-3 py-3 text-right text-xs font-semibold text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id} className="border-b border-gray-200/60 last:border-0">
                  <td className="px-3 py-3 text-sm">{index + 1}</td>
                  <td className="px-3 py-3 text-sm">
                    <p className="font-medium text-gray-900">{item.raw_material?.nama || item.catatan || "-"}</p>
                    {item.raw_material?.kode && <p className="text-xs text-gray-500">{item.raw_material.kode}</p>}
                    {item.catatan && <p className="text-xs text-gray-500">{item.catatan}</p>}
                  </td>
                  <td className="px-3 py-3 text-center text-sm">{formatNumber(item.qty_ordered, 4)}</td>
                  <td className="px-3 py-3 text-center text-sm">{item.satuan?.nama || "-"}</td>
                  <td className="px-3 py-3 text-right text-sm">{formatRupiah(item.harga_satuan)}</td>
                  <td className="px-3 py-3 text-right text-sm font-semibold">{formatRupiah(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-keep mb-6 flex justify-end">
          <div className="w-full max-w-sm rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <div className="flex justify-between py-1.5 text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium text-gray-900">{formatRupiah(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-500">Diskon{poData.diskon_persen ? ` (${poData.diskon_persen}%)` : ""}</span>
                <span className="font-medium text-red-600">- {formatRupiah(discount)}</span>
              </div>
            )}
            {taxPercent > 0 && (
              <div className="flex justify-between py-1.5 text-sm">
                <span className="text-gray-500">PPN ({taxPercent}%)</span>
                <span className="font-medium text-gray-900">{formatRupiah(taxAmount)}</span>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-gray-200/70 pt-3 text-base font-bold">
              <span>Total</span>
              <span>{formatRupiah(total)}</span>
            </div>
          </div>
        </section>

        <section className="print-keep mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200/70 p-4">
            <h2 className="text-sm font-semibold text-gray-900">Ketentuan & Pengiriman</h2>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Ketentuan Pembayaran</p>
                <p className="font-medium text-gray-900">Sesuai termin pembayaran PO</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Alamat Pengiriman</p>
                <p className="whitespace-pre-wrap text-gray-700">{poData.alamat_pengiriman || "-"}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200/70 p-4">
            <h2 className="text-sm font-semibold text-gray-900">Catatan</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{poData.catatan || "-"}</p>
          </div>
        </section>

        <div className="print-keep">
          <section className="mt-8">
            <div className="print-break-after-avoid mb-4 border-b border-gray-200/70 pb-2">
              <h2 className="text-sm font-semibold text-gray-900">Persetujuan / Approval</h2>
              <p className="text-xs text-gray-500">Dokumen purchase order dan penerimaan vendor</p>
            </div>
            <div className="grid grid-cols-3 gap-8">
              <div className="text-center">
                <p className="mb-12 text-xs text-gray-500">Dibuat oleh,</p>
                <div className="mx-4 border-t border-gray-300 pt-2">
                  <p className="text-sm font-semibold text-gray-900">Purchasing Staff</p>
                  <p className="text-xs text-gray-500">Aapex Technology</p>
                </div>
              </div>
              <div className="text-center">
                <p className="mb-12 text-xs text-gray-500">Disetujui oleh,</p>
                <div className="mx-4 border-t border-gray-300 pt-2">
                  <p className="text-sm font-semibold text-gray-900">Purchasing Manager</p>
                  <p className="text-xs text-gray-500">Aapex Technology</p>
                </div>
              </div>
              <div className="text-center">
                <p className="mb-12 text-xs text-gray-500">Diterima oleh Vendor,</p>
                <div className="mx-4 border-t border-gray-300 pt-2">
                  <p className="text-sm font-semibold text-gray-900">........................</p>
                  <p className="text-xs text-gray-500">Nama & Stamp</p>
                </div>
              </div>
            </div>
          </section>

          <footer className="mt-10 border-t border-gray-200/70 pt-4 text-center text-xs text-gray-400">
            <p>Generated by Aapex Purchasing System</p>
            <p className="mt-1">Printed: {formatDateTime(new Date())}</p>
          </footer>
        </div>
      </main>

      <PrintFloatingButton />
    </div>
  );
}
