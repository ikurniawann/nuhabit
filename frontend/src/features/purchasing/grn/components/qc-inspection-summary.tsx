import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import type { QcOverallStatus } from "@/lib/purchasing/grn-qc-utils";

const STATUS: Record<QcOverallStatus, { label: string; className: string }> = {
  approved: { label: "Disetujui", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  partial: { label: "Sebagian", className: "border-amber-200 bg-amber-50 text-amber-700" },
  rejected: { label: "Ditolak", className: "border-red-200 bg-red-50 text-red-700" },
};

const RECOMMENDATION: Record<QcOverallStatus, { text: string; className: string; icon: ReactNode }> = {
  approved: { text: "Terima dan posting stok", className: "text-emerald-700", icon: <CheckCircle2 className="h-4 w-4" /> },
  rejected: { text: "Tolak — tanpa pergerakan stok", className: "text-red-600", icon: <XCircle className="h-4 w-4" /> },
  partial: {
    text: "Terima sebagian — posting qty lolos saja",
    className: "text-amber-700",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

type Props = {
  status: QcOverallStatus;
  totals: { inspected: number; accepted: number; rejected: number };
  parameters: { ok: number; ng: number; na: number };
};

export function QcSummaryCards({ status, totals, parameters }: Props) {
  const recommendation = RECOMMENDATION[status];
  const qty = (value: number) => formatNumber(value, 4);
  return (
    <div className="space-y-6 xl:col-span-4">
      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Ringkasan Inspeksi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Hasil Keseluruhan</span>
            <Badge variant="outline" className={STATUS[status].className}>
              {STATUS[status].label}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/70 px-3 py-2 text-center">
              <p className="text-xs text-gray-500">Diinspeksi</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{qty(totals.inspected)}</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-center">
              <p className="text-xs text-emerald-700">Lolos</p>
              <p className="mt-1 text-sm font-semibold text-emerald-800">{qty(totals.accepted)}</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center">
              <p className="text-xs text-red-700">Gagal</p>
              <p className="mt-1 text-sm font-semibold text-red-700">{qty(totals.rejected)}</p>
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-200/70 pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Parameter OK</span>
              <span className="font-medium text-emerald-700">{parameters.ok}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Parameter NG</span>
              <span className="font-medium text-red-600">{parameters.ng}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Parameter N/A</span>
              <span className="font-medium text-gray-700">{parameters.na}</span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rekomendasi</p>
            <span className={`mt-2 flex items-center gap-2 text-sm font-medium ${recommendation.className}`}>
              {recommendation.icon}
              {recommendation.text}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 bg-gray-50/40 shadow-xs">
        <CardContent className="space-y-2 p-4 text-sm text-gray-600">
          <p className="font-medium text-gray-900">Sebelum mengirim</p>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5">
            <li>Qty lolos akan diposting ke stok gudang.</li>
            <li>Qty gagal tidak masuk stok tersedia.</li>
            <li>Hasil inspeksi terhubung permanen ke GRN ini.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
