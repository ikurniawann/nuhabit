import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { printBytesViaRawBt, canUseRawBtPrint } from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, formatReceiptRow } from "@/lib/pos/thermal-escpos";
import { printBytesToPairedThermal } from "@/lib/pos/thermal-serial";
import { escapeHtml } from "@/lib/security/escape-html";

export type TopupReceiptPrintPayload = {
  customerName: string;
  phone?: string;
  amount: number;
  arkAmountLabel: string;
  paymentMethod: string;
  balanceBeforeLabel: string;
  balanceAfterLabel: string;
  amountLabel: string;
  cardId?: string | null;
};

/** ESC/POS layout matching the HTML topup ticket. */
export function buildTopupReceiptEscPosBytes(payload: TopupReceiptPrintPayload): Uint8Array {
  const when = formatDateTime(new Date());
  const lines: Array<{ text: string; align: "left" | "center" }> = [
    { text: "--- TOPUP ---", align: "center" },
    { text: "ARK E-MONEY", align: "center" },
    { text: when, align: "center" },
    { text: "--------------------------------", align: "left" },
    { text: payload.customerName, align: "center" },
  ];
  if (payload.phone) lines.push({ text: payload.phone, align: "center" });
  if (payload.cardId) lines.push({ text: `Card ${payload.cardId}`, align: "center" });
  lines.push({ text: "--------------------------------", align: "left" });
  lines.push({ text: payload.arkAmountLabel, align: "center" });
  lines.push({ text: payload.amountLabel, align: "center" });
  lines.push({ text: "--------------------------------", align: "left" });
  lines.push({
    text: formatReceiptRow("Method", payload.paymentMethod.toUpperCase()),
    align: "left",
  });
  lines.push({
    text: formatReceiptRow("Before", payload.balanceBeforeLabel),
    align: "left",
  });
  lines.push({
    text: formatReceiptRow("Balance", payload.balanceAfterLabel),
    align: "left",
  });
  lines.push({ text: "--------------------------------", align: "left" });
  lines.push({ text: "--- TOPUP COPY ---", align: "center" });
  return encodeEscPosLines(lines);
}

/** HTML tiket topup untuk jendela print; setiap nilai di-escape (nama/HP dari data member). */
export function buildTopupReceiptHtml(payload: TopupReceiptPrintPayload, when: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>TOPUP RECEIPT</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        background: #f3f4f6;
        padding: 24px 16px;
        display: flex;
        justify-content: center;
      }
      .ticket {
        width: 72mm;
        max-width: 100%;
        background: #fff;
        padding: 6mm 4mm;
        box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      }
      h1 { font-size:15px; text-align:center; letter-spacing:2px; margin-bottom:4px; }
      .center { text-align:center; }
      .divider { border-top:1px dashed #000; margin:6px 0; }
      .big { font-size:16px; font-weight:bold; text-align:center; margin:4px 0; }
      .row { display:flex; justify-content:space-between; gap:8px; margin:2px 0; }
      .row.total { font-weight:bold; font-size:14px; margin-top:4px; }
      @media print {
        body { background:#fff; padding:0; display:block; }
        .ticket { width:72mm; box-shadow:none; }
        @page { margin:0; size:72mm auto; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
      <h1>--- TOPUP ---</h1>
      <div class="center">ARK E-MONEY</div>
      <div class="center">${escapeHtml(when)}</div>
      <div class="divider"></div>
      <div class="center">${escapeHtml(payload.customerName)}</div>
      ${payload.phone ? `<div class="center">${escapeHtml(payload.phone)}</div>` : ""}
      ${payload.cardId ? `<div class="center">Card ${escapeHtml(payload.cardId)}</div>` : ""}
      <div class="divider"></div>
      <div class="big">${escapeHtml(payload.arkAmountLabel)}</div>
      <div class="center">${escapeHtml(payload.amountLabel)}</div>
      <div class="divider"></div>
      <div class="row"><span>Method</span><span>${escapeHtml(payload.paymentMethod.toUpperCase())}</span></div>
      <div class="row"><span>Before</span><span>${escapeHtml(payload.balanceBeforeLabel)}</span></div>
      <div class="row total"><span>Balance</span><span>${escapeHtml(payload.balanceAfterLabel)}</span></div>
      <div class="divider"></div>
      <div class="center">--- TOPUP COPY ---</div>
    </div>
  </body>
</html>`;
}

function printTopupViaPopup(payload: TopupReceiptPrintPayload) {
  const popupWidth = Math.min(720, Math.max(480, window.screen.availWidth - 80));
  const popupHeight = Math.min(900, Math.max(640, window.screen.availHeight - 80));
  const left = Math.max(0, Math.round((window.screen.availWidth - popupWidth) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - popupHeight) / 2));
  const win = window.open(
    "",
    "_blank",
    `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );

  if (!win) {
    throw new Error("Allow popups to print the receipt.");
  }

  win.document.write(buildTopupReceiptHtml(payload, formatDateTime(new Date())));

  win.document.close();
  win.focus();
  window.setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}

/** Print topup receipt — RawBT on Android Chrome, else Web Serial / HTML popup. */
export async function printTopupReceipt(payload: TopupReceiptPrintPayload) {
  const escPos = buildTopupReceiptEscPosBytes(payload);

  if (canUseRawBtPrint() && printBytesViaRawBt(escPos)) {
    toast.success("Print dikirim ke RawBT");
    return;
  }

  try {
    const sent = await printBytesToPairedThermal(escPos);
    if (sent) {
      toast.success("Print");
      return;
    }
  } catch {
    // fall through to HTML
  }

  printTopupViaPopup(payload);
}
