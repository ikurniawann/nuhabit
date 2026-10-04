import { toast } from "sonner";
import { canUseRawBtPrint, printBytesViaRawBt } from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, RECEIPT_DIVIDER } from "@/lib/pos/thermal-escpos";
import { printBytesToPairedThermal } from "@/lib/pos/thermal-serial";
import { escapeHtml } from "@/lib/security/escape-html";

export type QueueSlipPayload = {
  queueLabel: string;
  guestName: string;
  paxCount: number;
  dateLabel: string;
  timeLabel: string;
  tableLabel?: string | null;
  merchantName?: string | null;
};

/**
 * Slip nomor antrian reservasi/waiting list (owner 2026-08-16) — kertas 80mm.
 * Jalur print sama dengan struk: RawBT (Android) → Web Serial → dialog browser.
 */
export function buildQueueSlipEscPosBytes(payload: QueueSlipPayload): Uint8Array {
  const lines: Array<{ text: string; align: "left" | "center" }> = [
    { text: "NOMOR ANTRIAN", align: "center" },
  ];
  if (payload.merchantName) lines.push({ text: payload.merchantName, align: "center" });
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  // Nomor dibesarkan dengan spasi antar-huruf supaya menonjol di thermal
  lines.push({ text: payload.queueLabel.split("").join(" "), align: "center" });
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  lines.push({ text: payload.guestName, align: "center" });
  lines.push({ text: `${payload.paxCount} orang`, align: "center" });
  lines.push({ text: `${payload.dateLabel} · ${payload.timeLabel}`, align: "center" });
  if (payload.tableLabel) lines.push({ text: `Meja ${payload.tableLabel}`, align: "center" });
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  lines.push({ text: "Tunjukkan nomor ini saat dipanggil", align: "center" });
  return encodeEscPosLines(lines);
}

/** HTML slip untuk jendela print; nama tamu dll. di-escape. */
export function buildQueueSlipHtml(payload: QueueSlipPayload): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Antrian ${escapeHtml(payload.queueLabel)}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Courier New',monospace; font-size:13px; padding:8px; }
      .ticket { width:76mm; max-width:100%; padding:4mm 2mm; text-align:center; }
      .divider { border-top:1px dashed #000; margin:8px 0; }
      .num { font-size:44px; font-weight:bold; letter-spacing:4px; margin:6px 0; }
      @media print { @page { margin:0; size:80mm auto; } .ticket { padding:2mm; } }
    </style>
  </head>
  <body>
    <div class="ticket">
      <div style="font-weight:bold">NOMOR ANTRIAN</div>
      ${payload.merchantName ? `<div>${escapeHtml(payload.merchantName)}</div>` : ""}
      <div class="divider"></div>
      <div class="num">${escapeHtml(payload.queueLabel)}</div>
      <div class="divider"></div>
      <div style="font-weight:bold">${escapeHtml(payload.guestName)}</div>
      <div>${escapeHtml(payload.paxCount)} orang</div>
      <div>${escapeHtml(payload.dateLabel)} · ${escapeHtml(payload.timeLabel)}</div>
      ${payload.tableLabel ? `<div>Meja ${escapeHtml(payload.tableLabel)}</div>` : ""}
      <div class="divider"></div>
      <div>Tunjukkan nomor ini saat dipanggil</div>
    </div>
  </body>
</html>`;
}

export async function printQueueSlip(payload: QueueSlipPayload) {
  const escPos = buildQueueSlipEscPosBytes(payload);

  if (canUseRawBtPrint()) {
    if (printBytesViaRawBt(escPos)) {
      toast.success("Slip antrian dikirim ke printer");
      return;
    }
  }

  try {
    const sent = await printBytesToPairedThermal(escPos);
    if (sent) {
      toast.success("Slip antrian dicetak");
      return;
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Print langsung gagal, memakai dialog browser");
  }

  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Gagal membuka jendela print. Izinkan popup di browser.");
    return;
  }
  win.document.open();
  win.document.write(buildQueueSlipHtml(payload));
  win.document.close();
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      win.close();
    }
  }, 300);
}
