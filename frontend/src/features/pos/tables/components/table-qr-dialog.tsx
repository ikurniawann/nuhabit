"use client";

import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download, ExternalLink, Printer } from "lucide-react";
import { appOrigin } from "@/lib/app-origin";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import type { PosTableRow } from "../types";

/** URL self-order yang di-encode ke QR meja — kode = qr_code (fallback nomor meja). */
export function tableOrderUrl(table: Pick<PosTableRow, "qr_code" | "table_number">, origin: string) {
  const code = (table.qr_code || table.table_number || "").trim();
  return `${origin.replace(/\/$/, "")}/table-order/${encodeURIComponent(code)}`;
}

/**
 * Dialog QR self-order per meja: tampilkan QR + URL, salin, unduh PNG, cetak
 * kartu meja. Tanpa ini kode QR di tabel hanya string — tidak ada yang bisa
 * ditempel di meja.
 */
export function TableQrDialog({
  table,
  onClose,
}: {
  table: PosTableRow | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const canvasHost = useRef<HTMLDivElement>(null);
  const svgHost = useRef<HTMLDivElement>(null);

  const origin = appOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
  const url = useMemo(() => (table ? tableOrderUrl(table, origin) : ""), [table, origin]);
  const label = table?.name || table?.table_number || "";

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link self-order disalin");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Gagal menyalin — salin manual dari kolom URL");
    }
  }

  function downloadPng() {
    const canvas = canvasHost.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `qr-meja-${(table?.table_number || "meja").replace(/[^A-Za-z0-9_-]/g, "")}.png`;
    link.click();
  }

  function printCard() {
    const svg = svgHost.current?.innerHTML || "";
    const win = window.open("", "_blank", "width=480,height=640");
    if (!win) {
      toast.error("Pop-up diblokir — izinkan pop-up untuk mencetak");
      return;
    }
    win.document.write(`<!doctype html><html><head><title>QR Meja ${label}</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{width:320px;padding:28px 24px;border:2px dashed #999;border-radius:16px;text-align:center}
  .card svg{width:220px;height:220px}
  h1{font-size:28px;margin:0 0 4px} p{margin:6px 0 0;color:#444;font-size:14px}
  .url{font-size:11px;color:#777;word-break:break-all;margin-top:10px}
  @media print{.card{border-color:#000}}
</style></head><body><div class="card">
  <h1>Meja ${escapeHtml(label)}</h1>
  <p>Scan untuk pesan dari meja</p>
  <div style="margin:16px 0">${svg}</div>
  <p><b>Pesan · Bayar QRIS · Kumpulkan XP</b></p>
  <div class="url">${escapeHtml(url)}</div>
</div><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <Dialog open={table !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>QR Self-Order · Meja {label}</DialogPanelTitle>
          <DialogPanelDescription>
            Tempel QR ini di meja. Pelanggan scan → langsung ke halaman pesan untuk meja ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="flex justify-center">
            <div ref={svgHost} className="rounded-xl border border-gray-200 bg-white p-3">
              {url && <QRCodeSVG value={url} size={200} marginSize={1} />}
            </div>
            <div ref={canvasHost} className="hidden">
              {url && <QRCodeCanvas value={url} size={1024} marginSize={2} />}
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">URL</div>
            <div className="mt-0.5 break-all font-mono text-xs text-gray-800">{url}</div>
            <div className="mt-1 text-[11px] text-gray-500">
              Kode QR: <span className="font-mono">{table?.qr_code || table?.table_number}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={copyUrl} className="h-9">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Salin link
            </Button>
            <Button type="button" variant="outline" onClick={downloadPng} className="h-9">
              <Download className="h-4 w-4" />
              Unduh PNG
            </Button>
            <Button type="button" variant="outline" onClick={printCard} className="h-9">
              <Printer className="h-4 w-4" />
              Cetak kartu
            </Button>
            <Button type="button" variant="outline" asChild className="h-9">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Buka
              </a>
            </Button>
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
