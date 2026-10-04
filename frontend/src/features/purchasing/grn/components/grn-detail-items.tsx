import { Banknote, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { GrnDetailItem, VendorCreditRow } from "../types";

const CREDIT_SOURCE_LABELS: Record<string, string> = {
  receive_reject: "Tolak Penerimaan",
  qc_reject: "Tolak QC",
};

const CREDIT_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-amber-200 bg-amber-50 text-amber-700" },
  pending_approval: { label: "Menunggu Persetujuan", className: "border-amber-200 bg-amber-50 text-amber-700" },
  approved: { label: "Disetujui", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Ditolak", className: "border-red-200 bg-red-50 text-red-700" },
  cancelled: { label: "Dibatalkan", className: "border-gray-200 bg-gray-50 text-gray-600" },
};

const qty = (value?: number | string | null) => formatNumber(value, 4);

export function GrnItemsCard({ items, itemColumnLabel }: { items: GrnDetailItem[]; itemColumnLabel: string }) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-pink-600" />
          Item Diterima
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="overflow-x-auto rounded-xl border border-gray-200/70">
          <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{itemColumnLabel}</th>
                <th className="w-[72px] px-2 py-3 text-center font-semibold">Satuan</th>
                <th className="w-[84px] px-2 py-3 text-center font-semibold">Dipesan</th>
                <th className="w-[84px] px-2 py-3 text-center font-semibold">Baik</th>
                <th className="w-[84px] px-2 py-3 text-center font-semibold">Tolak</th>
                <th className="w-[120px] px-2 py-3 text-right font-semibold">Harga Satuan</th>
                <th className="px-4 py-3 text-left font-semibold">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    Tidak ada item penerimaan.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="bg-white hover:bg-gray-50/80">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">{item.raw_material?.nama || item.product?.nama || "-"}</div>
                      <div className="text-xs text-gray-500">{item.raw_material?.kode || item.product?.kode || "-"}</div>
                      {(item.batch_number || item.expiry_date) && (
                        <div className="mt-1 text-xs text-gray-500">
                          Batch {item.batch_number || "-"}
                          {item.expiry_date ? ` · kedaluwarsa ${formatDate(item.expiry_date)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center align-middle text-gray-700">
                      {item.satuan?.nama || item.purchase_order_item?.satuan?.nama || item.raw_material?.satuan_besar?.nama || "-"}
                    </td>
                    <td className="px-2 py-3 text-center align-middle text-gray-700">
                      {qty(item.purchase_order_item?.qty_ordered)}
                    </td>
                    <td className="px-2 py-3 text-center align-middle font-semibold text-emerald-700">{qty(item.qty_diterima)}</td>
                    <td className="px-2 py-3 text-center align-middle font-semibold text-red-600">{qty(item.qty_ditolak)}</td>
                    <td className="px-2 py-3 text-right align-middle text-gray-700">
                      {formatRupiah(item.purchase_order_item?.harga_satuan)}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-600">{item.catatan || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function GrnVendorCreditsCard({ credits }: { credits: VendorCreditRow[] }) {
  if (credits.length === 0) return null;
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4 text-pink-600" />
          Vendor Credit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs leading-5 text-gray-600">
          Catatan otomatis dari qty tolak pintu atau QC. Kredit ini tidak disetujui dari sini — tagihan memakai sisa
          qty PO (qty pesan − qty lolos QC). Tutup PO jika supplier tidak mengganti kekurangan.
        </p>
        {credits.map((credit) => {
          const status = CREDIT_STATUS[credit.status];
          const awaitingApproval = credit.status === "draft" || credit.status === "pending_approval";
          return (
            <div key={credit.id} className="rounded-xl border border-gray-200/70 bg-gray-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">{credit.credit_number}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {CREDIT_SOURCE_LABELS[credit.source_type] || credit.source_type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={status?.className || "border-gray-200 bg-gray-50 text-gray-700"}>
                    {status?.label || credit.status.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-sm font-semibold text-gray-900">{formatRupiah(credit.total_amount)}</span>
                </div>
              </div>
              {(credit.items ?? []).length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-gray-600">
                  {credit.items?.map((line) => (
                    <li key={line.id} className="flex justify-between gap-2">
                      <span>
                        {line.raw_material?.nama || line.raw_material?.kode || "Item"} · {qty(line.qty)} ×{" "}
                        {formatRupiah(line.unit_price)}
                      </span>
                      <span className="font-medium text-gray-800">{formatRupiah(line.line_amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {awaitingApproval && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Persetujuan kredit reject dinonaktifkan. Kekurangan otomatis mengurangi tagihan lewat sisa qty PO.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
