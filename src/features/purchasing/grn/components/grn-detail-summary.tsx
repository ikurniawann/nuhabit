import Link from "next/link";
import { ClipboardCheck, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/format";
import type { GrnDetail, GrnQcInspection } from "../types";
import { SummaryRow } from "./receiving-form-parts";

const QC_STATUS_LABELS: Record<string, string> = {
  approved: "Disetujui",
  partial: "Sebagian",
  rejected: "Ditolak",
  pending: "Menunggu",
};

type Props = {
  grn: GrnDetail;
  qc: GrnQcInspection | null;
  poNumber: string;
  supplierLabel: string;
  /** Link inspeksi QC bila QC masih bisa dijalankan. */
  qcHref: string | null;
};

export function GrnDetailSummary({ grn, qc, poNumber, supplierLabel, qcHref }: Props) {
  const accepted = Number(grn.total_item_diterima || 0);
  const rejected = Number(grn.total_item_ditolak || 0);
  const checked = accepted + rejected;
  const acceptedPct = checked > 0 ? Math.round((accepted / checked) * 100) : 0;
  const qcStatus = String(qc?.status || qc?.hasil || "").toLowerCase();
  const qcRejected = qcStatus.includes("reject");

  return (
    <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base">Ringkasan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <dl className="space-y-3 text-sm">
          <SummaryRow label="Purchase Order">{poNumber}</SummaryRow>
          <SummaryRow label={supplierLabel}>{grn.supplier_name || grn.supplier?.nama_supplier || "-"}</SummaryRow>
          <SummaryRow label="Jumlah Item">{grn.items?.length || 0}</SummaryRow>
          <div className="grid grid-cols-2 gap-2 border-t border-gray-200/70 pt-3">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700">Baik</p>
              <p className="mt-1 text-sm font-semibold text-emerald-800">{formatNumber(accepted, 4)}</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700">Tolak</p>
              <p className="mt-1 text-sm font-semibold text-red-700">{formatNumber(rejected, 4)}</p>
            </div>
          </div>
          <SummaryRow label="Tingkat Penerimaan" strong className="border-t border-gray-200/70 pt-3">
            {acceptedPct}%
          </SummaryRow>
        </dl>

        <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <ClipboardCheck className="h-4 w-4 text-pink-600" />
            Quality Control
          </div>
          {!qc ? (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-gray-600">
                Belum ada inspeksi QC. Selesaikan QC untuk memposting qty lolos ke stok.
              </p>
              {qcHref && (
                <Link href={qcHref}>
                  <Button size="sm" className="purchasing-main-button h-8">
                    <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
                    Mulai Inspeksi
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <dl className="space-y-2 text-xs text-gray-600">
              <SummaryRow label="Status">{QC_STATUS_LABELS[qcStatus] || qc.status || qc.hasil || "-"}</SummaryRow>
              <SummaryRow label="Inspektor">
                {qc.inspected_by_user?.email || qc.inspector?.email || qc.inspector?.name || "-"}
              </SummaryRow>
              <SummaryRow label="Tanggal Inspeksi">{formatDate(qc.inspected_at || qc.tanggal_inspeksi)}</SummaryRow>
              {(qc.catatan_qc || qc.catatan) && (
                <div>
                  <dt className="mb-1">Catatan</dt>
                  <dd className="rounded-lg border border-gray-200/70 bg-white px-3 py-2 text-gray-700">
                    {qc.catatan_qc || qc.catatan}
                  </dd>
                </div>
              )}
              <p className={`pt-1 font-medium ${qcRejected ? "text-red-600" : "text-emerald-600"}`}>
                {qcRejected ? "QC menemukan masalah" : "QC selesai"}
              </p>
            </dl>
          )}
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <Info className="h-4 w-4 text-pink-600" />
            Kontak {supplierLabel}
          </div>
          <dl className="space-y-2 text-xs text-gray-600">
            <SummaryRow label="Email">{grn.supplier?.email || "-"}</SummaryRow>
            <SummaryRow label="Telepon">{grn.supplier?.telepon || "-"}</SummaryRow>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
