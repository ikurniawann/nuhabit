"use client";

import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber, formatRupiah } from "@/lib/format";
import { useCampaignReport } from "../queries";

/** Funnel satu kampanye: antrean → terkirim → voucher dipakai (+ in-app dibuka/diklik). */
export function CampaignReportDialog({ reportId, onClose }: { reportId: string | null; onClose: () => void }) {
  const reportQuery = useCampaignReport(reportId);
  const report = reportQuery.data;

  return (
    <Dialog open={reportId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Laporan — {report?.campaign.name ?? "…"}</DialogTitle>
        </DialogHeader>
        {reportQuery.isLoading || !report ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {report.campaign.failure_reason && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{report.campaign.failure_reason}</p>
            )}
            {report.campaign.channels.includes("in_app") && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["In-app terkirim", report.in_app.sent],
                    ["Dibuka", report.in_app.opened],
                    ["Diklik", report.in_app.clicked],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-gray-200/70 px-3 py-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="font-semibold tabular-nums text-gray-900">{formatNumber(value)}</p>
                  </div>
                ))}
              </div>
            )}
            {(
              [
                ["Total antrean", report.funnel.total],
                ["Menunggu kirim", report.funnel.pending],
                ["WA terkirim", report.funnel.sent],
                ["WA gagal", report.funnel.failed],
                ["Voucher dipakai", report.funnel.redeemed],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between rounded-lg border border-gray-200/70 px-3 py-2">
                <span className="text-gray-600">{label}</span>
                <span className="font-semibold tabular-nums text-gray-900">{formatNumber(value)}</span>
              </div>
            ))}
            {report.funnel.redeemed_value > 0 && (
              <p className="text-xs text-gray-500">Nilai potongan terpakai: {formatRupiah(report.funnel.redeemed_value)}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
