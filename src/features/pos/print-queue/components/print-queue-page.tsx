"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  canUseRawBtPrint,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, formatReceiptRow } from "@/lib/pos/thermal-escpos";
import type { PrintJob, PrintJobAction } from "../types";
import { usePrintJobs } from "../queries";
import { useUpdatePrintJob } from "../mutations";
import { brandName } from "@/lib/branding";
import { formatDateTime, formatNumber } from "@/lib/format";

const STATIONS = [
  { value: "all", label: "Semua" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "bakery", label: "Bakery" },
  { value: "dessert", label: "Dessert" },
];

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "printing", label: "Printing" },
  { value: "printed", label: "Printed" },
  { value: "all", label: "Semua" },
];

const statusTone: Record<PrintJob["status"], string> = {
  pending: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  printing: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  printed: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  failed: "bg-red-100 text-red-700 hover:bg-red-100",
  cancelled: "bg-gray-100 text-gray-700 hover:bg-gray-100",
};

function stationLabel(value: string) {
  return STATIONS.find((station) => station.value === value)?.label || value;
}

function escapeHtml(value?: string | number | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildTicketEscPosBytes(job: PrintJob): Uint8Array {
  const items = job.payload?.items || [];
  const lines: Array<{ text: string; align: "left" | "center" }> = [
    { text: stationLabel(job.station).toUpperCase(), align: "center" },
    { text: job.job_type.replaceAll("_", " "), align: "center" },
    { text: "--------------------------------", align: "left" },
    {
      text: formatReceiptRow(
        "Order",
        String(job.order?.order_number || job.order_id.slice(0, 8)),
      ),
      align: "left",
    },
    {
      text: formatReceiptRow("Type", String(job.order?.order_type || "-")),
      align: "left",
    },
    {
      text: formatReceiptRow("Time", formatDateTime(job.requested_at)),
      align: "left",
    },
    { text: "--------------------------------", align: "left" },
  ];

  if (items.length === 0) {
    lines.push({ text: "Tidak ada item.", align: "left" });
  } else {
    for (const item of items) {
      lines.push({
        text: formatReceiptRow(
          String(item.product_name || "Item"),
          `x${item.quantity || 1}`,
        ),
        align: "left",
      });
      if (item.notes) lines.push({ text: `  ${item.notes}`, align: "left" });
    }
  }

  lines.push({ text: "--------------------------------", align: "left" });
  lines.push({ text: `${brandName().toUpperCase()} POS PRINT QUEUE`, align: "center" });
  return encodeEscPosLines(lines);
}

function buildTicketHtml(job: PrintJob) {
  const items = job.payload?.items || [];
  const itemRows = items.map((item) => `
    <div class="item">
      <div>
        <strong>${escapeHtml(item.product_name || "Item")}</strong>
        ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}
      </div>
      <b>x${escapeHtml(item.quantity || 1)}</b>
    </div>
  `).join("");

  return `<!doctype html>
    <html>
      <head>
        <title>${escapeHtml(job.order?.order_number || "Print Ticket")}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #111; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
          .ticket { width: 72mm; padding: 8px; }
          .center { text-align: center; }
          h1 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0; text-transform: uppercase; }
          .muted { color: #555; font-size: 11px; }
          .line { border-top: 1px dashed #111; margin: 10px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
          .item { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #999; }
          .item small { display: block; color: #555; margin-top: 2px; }
          b, strong { font-weight: 800; }
        </style>
      </head>
      <body>
        <main class="ticket">
          <div class="center">
            <h1>${escapeHtml(stationLabel(job.station))}</h1>
            <div class="muted">${escapeHtml(job.job_type.replace("_", " "))}</div>
          </div>
          <div class="line"></div>
          <div class="row"><span>Order</span><strong>${escapeHtml(job.order?.order_number || job.order_id.slice(0, 8))}</strong></div>
          <div class="row"><span>Type</span><strong>${escapeHtml(job.order?.order_type || "-")}</strong></div>
          <div class="row"><span>Time</span><strong>${escapeHtml(formatDateTime(job.requested_at))}</strong></div>
          <div class="line"></div>
          ${itemRows || `<div class="muted">Tidak ada item.</div>`}
          <div class="line"></div>
          <div class="center muted">${brandName().toUpperCase()} POS PRINT QUEUE</div>
        </main>
        <script>
          window.addEventListener("load", function () {
            window.focus();
            window.print();
          });
        </script>
      </body>
    </html>`;
}

export function PrintQueuePage() {
  const [previewJob, setPreviewJob] = useState<PrintJob | null>(null);
  const [station, setStation] = useState("all");
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");

  const { data: jobs = [], isLoading, isFetching, error: queryError, refetch } = usePrintJobs({
    station,
    status,
    limit: 100,
  });
  const updateJobMutation = useUpdatePrintJob();
  const loading = isLoading || isFetching;
  const queryErrorMessage = queryError instanceof Error ? queryError.message : "";

  const summary = useMemo(() => ({
    pending: jobs.filter((job) => job.status === "pending").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    printed: jobs.filter((job) => job.status === "printed").length,
  }), [jobs]);

  async function updateJob(jobId: string, action: PrintJobAction) {
    setError("");
    try {
      await updateJobMutation.mutateAsync({ jobId, action });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal update print job");
    }
  }

  function printFromBrowser(job: PrintJob) {
    // Android Chrome: same ticket content via RawBT ESC/POS.
    if (canUseRawBtPrint() && printBytesViaRawBt(buildTicketEscPosBytes(job))) {
      toast.success("Print dikirim ke RawBT");
      return;
    }

    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) {
      setError("Popup print diblokir browser. Izinkan popup untuk halaman ini lalu coba lagi.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildTicketHtml(job));
    printWindow.document.close();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Print Queue</h1>
          <p className="text-sm text-gray-500">Monitor ticket kitchen, bar, dan station lain sebelum printer fisik disambungkan.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/pos/printer-settings"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
          >
            <Settings className="size-4" />
            Settings Printer
          </Link>
          <Button variant="outline" onClick={() => void refetch()} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {(error || queryErrorMessage) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="size-4" />
          {error || queryErrorMessage}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Clock} label="Pending" value={summary.pending} tone="amber" />
        <Metric icon={XCircle} label="Failed" value={summary.failed} tone="red" />
        <Metric icon={CheckCircle2} label="Printed" value={summary.printed} tone="emerald" />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {STATIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStation(item.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                station === item.value
                  ? "border-pink-600 bg-pink-50 text-pink-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {item.label}
            </button>
          ))}
          <div className="mx-1 h-9 w-px bg-gray-200" />
          {STATUSES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                status === item.value
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-20 text-sm text-gray-500">
          <Loader2 className="size-5 animate-spin" />
          Memuat print queue...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-20 text-center">
          <Printer className="mx-auto size-10 text-pink-500" />
          <div className="mt-3 font-semibold text-gray-950">Tidak ada print job</div>
          <div className="mt-1 text-sm text-gray-500">Ticket baru akan muncul otomatis saat order dikirim.</div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {jobs.map((job) => (
            <article key={job.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-mono text-base font-bold text-gray-950">
                      {job.order?.order_number || job.order_id.slice(0, 8)}
                    </h2>
                    <Badge className={statusTone[job.status]}>{job.status}</Badge>
                    <Badge variant="outline" className="capitalize">{stationLabel(job.station)}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    {job.job_type.replace("_", " ")} · {formatDateTime(job.requested_at)} · Attempt {job.attempts}
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-xs text-gray-500">Order</div>
                  <div className="font-semibold capitalize text-gray-900">{job.order?.order_type || "-"}</div>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 px-3">
                {(job.payload?.items || []).map((item, index) => (
                  <div key={`${job.id}-${index}`} className="flex items-start justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900">{item.product_name || "Item"}</div>
                      {item.notes && <div className="text-xs italic text-amber-600">{item.notes}</div>}
                    </div>
                    <div className="rounded-md bg-white px-2 py-1 text-xs font-bold text-gray-700">
                      x{item.quantity || 1}
                    </div>
                  </div>
                ))}
              </div>

              {job.last_error && (
                <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {job.last_error}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-2 border-gray-200 text-gray-700 hover:bg-gray-50"
                  onClick={() => setPreviewJob(job)}
                >
                  <Eye className="size-4" />
                  Preview
                </Button>
                {job.status === "pending" && (
                  <Button
                    className="gap-2 bg-pink-600 hover:bg-pink-700"
                    onClick={() => updateJob(job.id, "mark_printing")}
                    disabled={updateJobMutation.isPending && updateJobMutation.variables?.jobId === job.id}
                  >
                    <Send className="size-4" />
                    Kirim Print
                  </Button>
                )}
                {job.status === "printing" && (
                  <>
                    <Button
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => updateJob(job.id, "mark_printed")}
                      disabled={updateJobMutation.isPending && updateJobMutation.variables?.jobId === job.id}
                    >
                      <CheckCircle2 className="size-4" />
                      Printed
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => updateJob(job.id, "mark_failed")}
                      disabled={updateJobMutation.isPending && updateJobMutation.variables?.jobId === job.id}
                    >
                      <XCircle className="size-4" />
                      Failed
                    </Button>
                  </>
                )}
                {job.status === "failed" && (
                  <Button
                    variant="outline"
                    className="gap-2 border-pink-200 text-pink-700 hover:bg-pink-50"
                    onClick={() => updateJob(job.id, "retry")}
                    disabled={updateJobMutation.isPending && updateJobMutation.variables?.jobId === job.id}
                  >
                    <RotateCcw className="size-4" />
                    Retry
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={!!previewJob} onOpenChange={(open) => !open && setPreviewJob(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Printer className="size-5 text-pink-600" />
              Print Preview
            </DialogTitle>
          </DialogHeader>

          {previewJob && (
            <div className="space-y-4">
              <ThermalTicket job={previewJob} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setPreviewJob(null)}>
                  Tutup
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 border-pink-200 text-pink-700 hover:bg-pink-50"
                  onClick={() => printFromBrowser(previewJob)}
                >
                  <Printer className="size-4" />
                  Browser Print
                </Button>
                {previewJob.status !== "printed" && (
                  <Button
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => updateJob(previewJob.id, "mark_printed")}
                    disabled={updateJobMutation.isPending && updateJobMutation.variables?.jobId === previewJob.id}
                  >
                    <CheckCircle2 className="size-4" />
                    Mark Printed
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThermalTicket({ job }: { job: PrintJob }) {
  const items = job.payload?.items || [];

  return (
    <div className="mx-auto w-full max-w-[320px] rounded-lg border border-gray-200 bg-white p-4 font-mono text-[12px] text-gray-950 shadow-sm">
      <div className="text-center">
        <div className="text-lg font-black uppercase tracking-normal">{stationLabel(job.station)}</div>
        <div className="text-[11px] uppercase text-gray-500">{job.job_type.replace("_", " ")}</div>
      </div>
      <div className="my-3 border-t border-dashed border-gray-400" />
      <div className="space-y-1">
        <div className="flex justify-between gap-3">
          <span>Order</span>
          <strong>{job.order?.order_number || job.order_id.slice(0, 8)}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span>Type</span>
          <strong className="capitalize">{job.order?.order_type || "-"}</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span>Time</span>
          <strong>{formatDateTime(job.requested_at)}</strong>
        </div>
      </div>
      <div className="my-3 border-t border-dashed border-gray-400" />
      <div>
        {items.length === 0 ? (
          <div className="py-3 text-center text-gray-500">Tidak ada item.</div>
        ) : (
          items.map((item, index) => (
            <div key={`${job.id}-ticket-${index}`} className="flex justify-between gap-3 border-b border-dashed border-gray-300 py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="font-black">{item.product_name || "Item"}</div>
                {item.notes && <div className="mt-1 text-[11px] text-gray-500">{item.notes}</div>}
              </div>
              <strong>x{item.quantity || 1}</strong>
            </div>
          ))
        )}
      </div>
      <div className="my-3 border-t border-dashed border-gray-400" />
      <div className="text-center text-[11px] text-gray-500">{brandName().toUpperCase()} POS PRINT QUEUE</div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  tone: "amber" | "red" | "emerald";
}) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    emerald: "bg-emerald-50 text-emerald-600",
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="text-xl font-bold text-gray-950">{formatNumber(value)}</div>
        </div>
      </div>
    </div>
  );
}
