"use client";

import { toast } from "sonner";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import {
  canUseRawBtPrint,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, formatReceiptRow, RECEIPT_DIVIDER } from "@/lib/pos/thermal-escpos";
import { resolveReceiptSettings } from "@/lib/pos/receipt-settings";
import { idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";
import { compReceiptLabel } from "@/lib/pos/comp-orders";
import {
  MEMBER_PORTAL_QR_CAPTION,
  MEMBER_PORTAL_QR_SVG,
  MEMBER_PORTAL_URL,
} from "@/lib/pos/member-qr";
import { printBytesToPairedThermal } from "@/lib/pos/thermal-serial";
import {
  buildReceiptItemLines,
  groupCartItemsByStallName,
  receiptDocumentLabel,
} from "@/lib/pos/receipt-layout";

export interface ReceiptPayload {
  orderId?: string;
  orderNumber?: string;
  checkoutNumber?: string;
  queueNumber?: string | null;
  orderType: string;
  table: string | null;
  items: PosCartItem[];
  notes: string;
  total: number;
  change: number;
  paymentMethod: string;
  customerName?: string;
  /** Stall asal order — dicetak di header semua copy (dapur perlu tahu asal). */
  stallName?: string | null;
  /** Σ harga item SEBELUM diskon apa pun; bila absen dihitung dari items. */
  subtotal?: number;
  discountAmount: number;
  /**
   * Rincian diskon per jenis (item/member/promo/manual) utk struk customer.
   * Bila absen, fallback satu baris "Diskon" dari discountAmount (payload lama).
   */
  discountLines?: Array<{ label: string; amount: number }>;
  taxAmount: number;
  /** Snapshot charge lines (service / fee / rounding / tax) for receipt */
  chargesBreakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
    rate?: number;
    calc_method?: string;
  }>;
  /**
   * EPIC-034 Fase B — kartu yang terbit dari transaksi ini. Kode dicetak di
   * struk pelanggan (keputusan owner: struk adalah jalur utama, WA tambahan).
   * Tidak pernah dicetak di copy dapur/bar — kode = uang.
   */
  giftCards?: Array<{ code: string; initial_value: number; expires_at: string | null }>;
  /**
   * EPIC-040 — identitas usaha dari pos_receipt_settings (nama, alamat,
   * kontak) dan penutup (terima kasih, WiFi, promo). Hanya customer copy &
   * preview bill; copy dapur/bar sengaja tidak memuatnya (hemat kertas).
   * Absen/kosong = struk tampil persis seperti sebelum EPIC-040.
   */
  receiptHeader?: string[];
  receiptFooter?: string[];
  /**
   * false = sembunyikan baris "Stall: …" di struk CUSTOMER/preview.
   * Copy dapur/bar selalu mencetaknya — dapur perlu tahu asal order.
   */
  receiptShowStallName?: boolean;
  /**
   * EPIC-041 task 1 — blok ARK Coin di struk customer (hanya pembayaran
   * ark_coin): harga & dibayar dalam ARK, plus sisa saldo. Nilai dalam
   * RUPIAH (satuan simpanan); konversi ke ARK saat render via arkRate.
   * arkBalanceAfter = snapshot respons pembayaran; reprint lama tanpa
   * snapshot → baris sisa saldo dilewati, bukan menebak.
   */
  arkPaid?: number;
  arkBalanceAfter?: number | null;
  arkRate?: number;
  /** EPIC-041 task 2 — XP transaksi ini & total XP member (bila member). */
  xpEarned?: number;
  xpTotalAfter?: number | null;
  /** EPIC-043 — komplimen: 'kol_comp' | 'owner_comp' + nama penyetuju. */
  compType?: string | null;
  compApprovedName?: string | null;
}

export type ThermalPrintLabel = "KITCHEN" | "BAR" | "CUSTOMER" | "PREVIEW_BILL";

function formatCurrency(n: number) {
  return "Rp " + new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Math.abs(n));
}

/** Rupiah → "N ARK" utk blok ARK; rate 0/absen jatuh ke default idrToArkDisplay. */
function formatArk(amountIdr: number, arkRate?: number) {
  return `${idrToArkDisplay(amountIdr, arkRate ?? 0).toLocaleString("id-ID")} ARK`;
}

/** Rupiah → "N Ark Coin" utk konversi inline harga ("Rp 25.000 / 25 Ark Coin"). */
function formatArkCoin(amountIdr: number, arkRate?: number) {
  return `${idrToArkDisplay(amountIdr, arkRate ?? 0).toLocaleString("id-ID")} Ark Coin`;
}

/** Baris header/footer struk berasal dari input admin — escape sebelum masuk HTML. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Tax" + rate percent → "Tax (10%)" supaya pembeli tahu tarifnya. */
function chargeLabel(line: { name: string; rate?: number; calc_method?: string }) {
  return line.calc_method === "percent" && Number(line.rate) > 0
    ? `${line.name} (${line.rate}%)`
    : line.name;
}

function itemsSubtotal(items: PosCartItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
}

export function buildReceiptLines(payload: ReceiptPayload, label: ThermalPrintLabel): string[] {
  return buildReceiptEscPosLayout(payload, label).map((line) => line.text);
}

/** Layout matching HTML receipt: centered header / footer, left items + totals. */
export function buildReceiptEscPosLayout(
  payload: ReceiptPayload,
  label: ThermalPrintLabel,
): Array<{ text: string; align: "left" | "center" }> {
  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const showIdentity = !isKitchen && !isBar;
  const headerLines = showIdentity ? (payload.receiptHeader ?? []) : [];
  const footerLines = showIdentity ? (payload.receiptFooter ?? []) : [];
  // Pembayaran ARK: seluruh harga (item, subtotal, total) diberi konversi ARK.
  // Deteksi via isArkCoinMethod — struk live membawa LABEL ("ARK Coin"), bukan
  // kode 'ark_coin'. arkPaid fallback ke total (ark_coin selalu bayar penuh).
  const isArkPayment = showIdentity && !isPreviewBill && isArkCoinMethod(payload.paymentMethod);
  const arkPaidValue = payload.arkPaid || (isArkPayment ? payload.total : 0);
  const lines: Array<{ text: string; align: "left" | "center" }> = [];
  if (headerLines.length > 0) {
    for (const line of headerLines) lines.push({ text: line, align: "center" });
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  }
  lines.push(
    { text: `--- ${heading} ---`, align: "center" },
    { text: payload.orderType.replace(/_/g, "-").toUpperCase(), align: "center" },
  );
  if (payload.table) lines.push({ text: payload.table, align: "center" });
  if (payload.queueNumber) {
    lines.push({ text: `ANTRIAN ${payload.queueNumber}`, align: "center" });
  }
  lines.push({
    text: receiptDocumentLabel(payload),
    align: "center",
  });
  lines.push({ text: new Date().toLocaleTimeString("id-ID"), align: "center" });
  if (payload.customerName) {
    lines.push({ text: `Customer: ${payload.customerName}`, align: "center" });
  }
  if (payload.stallName && (!showIdentity || payload.receiptShowStallName !== false)) {
    lines.push({ text: `Stall: ${payload.stallName}`, align: "center" });
  }
  if (isPreviewBill) {
    lines.push({ text: "PRE-SETTLEMENT - UNPAID", align: "center" });
  }
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });

  lines.push(
    ...buildReceiptItemLines(payload.items, {
      withPrices: !isKitchen && !isBar,
      headerStallName: payload.stallName,
      showArk: isArkPayment,
      arkRate: payload.arkRate,
    })
  );

  if (!isKitchen && !isBar) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    const subtotal = payload.subtotal ?? itemsSubtotal(payload.items);
    lines.push({
      text: formatReceiptRow(
        "Subtotal",
        isArkPayment
          ? `${formatCurrency(subtotal)} / ${formatArkCoin(subtotal, payload.arkRate)}`
          : formatCurrency(subtotal)
      ),
      align: "left",
    });
    const discountLines = (payload.discountLines ?? []).filter((d) => d.amount > 0);
    if (discountLines.length > 0) {
      for (const d of discountLines) {
        lines.push({
          text: formatReceiptRow(d.label, `-${formatCurrency(d.amount)}`),
          align: "left",
        });
      }
      if (discountLines.length > 1) {
        lines.push({
          text: formatReceiptRow("Total Diskon", `-${formatCurrency(payload.discountAmount)}`),
          align: "left",
        });
      }
    } else if (payload.discountAmount > 0) {
      lines.push({
        text: formatReceiptRow("Diskon", `-${formatCurrency(payload.discountAmount)}`),
        align: "left",
      });
    }
    if (payload.chargesBreakdown?.length) {
      for (const line of payload.chargesBreakdown) {
        const amountLabel =
          line.amount < 0 ? `-${formatCurrency(Math.abs(line.amount))}` : formatCurrency(line.amount);
        lines.push({ text: formatReceiptRow(chargeLabel(line), amountLabel), align: "left" });
      }
    } else if (payload.taxAmount > 0) {
      lines.push({
        text: formatReceiptRow("PPN", formatCurrency(payload.taxAmount)),
        align: "left",
      });
    }
    lines.push({
      text: formatReceiptRow(
        "TOTAL",
        isArkPayment
          ? `${formatCurrency(payload.total)} / ${formatArkCoin(payload.total, payload.arkRate)}`
          : formatCurrency(payload.total)
      ),
      align: "left",
    });
    if (isPreviewBill) {
      lines.push({ text: formatReceiptRow("Status", "UNPAID"), align: "left" });
    } else if (payload.compType) {
      // EPIC-043 — komplimen: tanpa baris Bayar/Kembalian; labelnya tegas.
      lines.push({ text: RECEIPT_DIVIDER, align: "left" });
      lines.push({
        text: compReceiptLabel(payload.compType, payload.compApprovedName) || "COMPLIMENTARY",
        align: "center",
      });
    } else {
      lines.push({
        text: formatReceiptRow(
          `Bayar (${payload.paymentMethod.toUpperCase()})`,
          formatCurrency(payload.total + payload.change),
        ),
        align: "left",
      });
      if (payload.change > 0) {
        lines.push({
          text: formatReceiptRow("Kembalian", formatCurrency(payload.change)),
          align: "left",
        });
      }
    }
    if (isPreviewBill) {
      // EPIC-043 — open bill (mis. Owner) diteken saat disetujui gratis;
      // blok tanda tangan di setiap preview bill.
      lines.push({ text: "", align: "left" });
      lines.push({ text: "Disetujui:", align: "left" });
      lines.push({ text: "", align: "left" });
      lines.push({ text: "____________________", align: "left" });
      lines.push({ text: "Nama: ______________", align: "left" });
    }
  }

  // EPIC-041 task 1-2 — blok ARK & XP, hanya struk customer yang sudah bayar.
  if (showIdentity && !isPreviewBill) {
    if (isArkPayment) {
      lines.push({ text: RECEIPT_DIVIDER, align: "left" });
      lines.push({ text: formatReceiptRow("Harga", formatArk(payload.total, payload.arkRate)), align: "left" });
      lines.push({ text: formatReceiptRow("Dibayar ARK", formatArk(arkPaidValue, payload.arkRate)), align: "left" });
      if (payload.arkBalanceAfter != null) {
        lines.push({
          text: formatReceiptRow(
            "Sisa saldo",
            `${formatArk(payload.arkBalanceAfter, payload.arkRate)} (${formatCurrency(payload.arkBalanceAfter)})`
          ),
          align: "left",
        });
      }
    }
    if ((payload.xpEarned ?? 0) > 0) {
      lines.push({ text: RECEIPT_DIVIDER, align: "left" });
      lines.push({ text: formatReceiptRow("XP didapat", `+${payload.xpEarned} XP`), align: "left" });
      if (payload.xpTotalAfter != null) {
        lines.push({
          text: formatReceiptRow("Total XP", `${Math.round(payload.xpTotalAfter).toLocaleString("id-ID")} XP`),
          align: "left",
        });
      }
    }
  }

  if (!isKitchen && !isBar && !isPreviewBill && payload.giftCards?.length) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    lines.push({ text: "GIFT CARD", align: "center" });
    for (const card of payload.giftCards) {
      lines.push({ text: card.code, align: "center" });
      lines.push({ text: `Saldo ${formatCurrency(card.initial_value)}`, align: "center" });
    }
  }

  if (payload.notes) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    lines.push({ text: `Catatan: ${payload.notes}`, align: "left" });
  }
  if (footerLines.length > 0) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    for (const line of footerLines) lines.push({ text: line, align: "center" });
  }
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  lines.push({ text: `--- ${heading} COPY ---`, align: "center" });
  return lines;
}

/** ESC/POS bytes for RawBT — same layout as desktop thermal / Chrome tablet HTML. */
export function buildReceiptEscPosBytes(
  payload: ReceiptPayload,
  label: ThermalPrintLabel,
): Uint8Array {
  // QR member portal di paling bawah — struk customer/preview saja; copy
  // dapur/bar tidak perlu (hemat kertas, tidak dibawa pembeli).
  const withQr = label !== "KITCHEN" && label !== "BAR";
  return encodeEscPosLines(buildReceiptEscPosLayout(payload, label), {
    qr: withQr
      ? { data: MEMBER_PORTAL_URL, caption: MEMBER_PORTAL_QR_CAPTION }
      : undefined,
  });
}

/**
 * Visible receipt tab — Android Chrome often captures the parent page when
 * printing from a 0×0 hidden iframe (cashier "screenshot dialog" bug).
 * Do not close until afterprint; early close breaks RawBT PDF handoff.
 */
function printViaPopupWindow(html: string) {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Gagal membuka jendela print. Izinkan popup di browser.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      win.close();
    } catch {
      // ignore
    }
  };

  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    // Safety net if afterprint never fires (some Android browsers)
    window.setTimeout(cleanup, 60_000);
  }, 300);
}

export function buildReceiptHtml(payload: ReceiptPayload, label: ThermalPrintLabel): string {
  const {
    queueNumber,
    orderType,
    table,
    items,
    notes,
    total,
    change,
    paymentMethod,
    customerName,
    stallName,
    discountAmount,
    taxAmount,
    chargesBreakdown,
    giftCards,
  } = payload;

  const isKitchenCopy = label === "KITCHEN" || label === "BAR";
  // Pembayaran ARK: item, subtotal, dan total diberi konversi ARK. Deteksi via
  // isArkCoinMethod (struk live membawa label "ARK Coin", bukan kode). arkPaid
  // fallback ke total karena pembayaran ark_coin selalu penuh (satu metode).
  const isArkPayment = !isKitchenCopy && label !== "PREVIEW_BILL" && isArkCoinMethod(paymentMethod);
  const arkPaidValue = payload.arkPaid || (isArkPayment ? total : 0);
  // Item dikelompokkan per stall tanpa baris judul "--- Stall ---": label
  // [Stall] per item sudah cukup (keputusan owner 2026-08-23, hemat kertas).
  const stallGroups = groupCartItemsByStallName(items);
  const colSpan = isKitchenCopy ? 2 : 3;
  const itemsHtml = stallGroups
    .map((group) => {
      const rows = group.items
        .map((item) => {
          const qty = Number(item.quantity) || 0;
          const lineTotal = (Number(item.price) || 0) * qty;
          const itemStall = item.stallName?.trim() || item.warehouse_name?.trim() || "";
          return `
    <tr>
      <td style="width:28px;vertical-align:top;font-weight:bold;padding:3px 2px">${item.quantity}x</td>
      <td style="padding:3px 2px">
        <strong>${item.name}</strong>
        ${itemStall && itemStall !== stallName ? `<br><small style="color:#0369a1;font-weight:600">[${itemStall}]</small>` : ""}
        ${!isKitchenCopy && qty > 1 ? `<br><small style="color:#555">@ ${formatCurrency(Number(item.price) || 0)}</small>` : ""}
        ${item.variantName ? `<br><small style="color:#555">${item.variantName}</small>` : ""}
        ${item.modifierNames?.length ? `<br><small style="color:#555">${item.modifierNames.join(", ")}</small>` : ""}
        ${item.notes ? `<br><em style="color:#555">* ${item.notes}</em>` : ""}
      </td>
      ${!isKitchenCopy ? `<td style="vertical-align:top;text-align:right;white-space:nowrap;padding:3px 2px">${formatCurrency(lineTotal)}${isArkPayment ? `<br><small style="color:#555">/ ${formatArkCoin(lineTotal, payload.arkRate)}</small>` : ""}</td>` : ""}
    </tr>
    <tr><td colspan="${colSpan}"><div style="border-top:1px dashed #ccc;margin:2px 0"></div></td></tr>
  `;
        })
        .join("");
      return rows;
    })
    .join("");

  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const title = isPreviewBill ? "PREVIEW BILL" : label;

  const showIdentity = !isKitchen && !isBar;
  const headerBlockHtml =
    showIdentity && payload.receiptHeader?.length
      ? payload.receiptHeader
          .map((line, i) =>
            i === 0
              ? `<div class="center" style="font-weight:bold;font-size:14px">${escapeHtml(line)}</div>`
              : `<div class="center" style="font-size:11px">${escapeHtml(line)}</div>`
          )
          .join("") + `<div class="divider"></div>`
      : "";
  const footerBlockHtml =
    showIdentity && payload.receiptFooter?.length
      ? `<div class="divider"></div>` +
        payload.receiptFooter
          .map((line) => `<div class="center" style="font-size:11px">${escapeHtml(line)}</div>`)
          .join("")
      : "";

  const receiptSubtotal = payload.subtotal ?? itemsSubtotal(items);
  const visibleDiscountLines = (payload.discountLines ?? []).filter((d) => d.amount > 0);
  const discountRowsHtml =
    visibleDiscountLines.length > 0
      ? visibleDiscountLines
          .map((d) => `<div class="row"><span>${d.label}</span><span>-${formatCurrency(d.amount)}</span></div>`)
          .join("") +
        (visibleDiscountLines.length > 1
          ? `<div class="row"><span>Total Diskon</span><span>-${formatCurrency(discountAmount)}</span></div>`
          : "")
      : discountAmount > 0
        ? `<div class="row"><span>Diskon</span><span>-${formatCurrency(discountAmount)}</span></div>`
        : "";

  const chargeRowsHtml =
    chargesBreakdown && chargesBreakdown.length > 0
      ? chargesBreakdown
          .map((line) => {
            const amountLabel =
              line.amount < 0
                ? `-${formatCurrency(Math.abs(line.amount))}`
                : formatCurrency(line.amount);
            return `<div class="row"><span>${chargeLabel(line)}</span><span>${amountLabel}</span></div>`;
          })
          .join("")
      : taxAmount > 0
        ? `<div class="row"><span>PPN</span><span>${formatCurrency(taxAmount)}</span></div>`
        : "";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { min-height: 100%; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        background: #fff;
        padding: 8px;
      }
      .ticket {
        width: 76mm; /* kertas 80mm, area cetak efektif */
        max-width: 100%;
        background: #fff;
        padding: 4mm 2mm;
      }
      h1 { font-size:15px; text-align:center; letter-spacing:2px; margin-bottom:4px; }
      .center { text-align:center; }
      .divider { border-top:1px dashed #000; margin:6px 0; }
      .big { font-size:16px; font-weight:bold; text-align:center; }
      .row { display:flex; justify-content:space-between; gap:8px; margin:2px 0; }
      .row.total { font-weight:bold; font-size:14px; margin-top:4px; }
      table { width:100%; border-collapse:collapse; }
      @media print {
        body { background: #fff; padding: 0; }
        .ticket { width: 76mm; padding: 2mm; }
        @page { margin: 0; size: 80mm auto; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
    ${headerBlockHtml}
    <h1>--- ${heading} ---</h1>
    <div class="big">${orderType.replace(/_/g, "-").toUpperCase()}</div>
    ${table ? `<div class="center">${table}</div>` : ""}
    ${queueNumber ? `<div class="big">ANTRIAN ${queueNumber}</div>` : ""}
    <div class="center">${receiptDocumentLabel(payload)}</div>
    <div class="center">${new Date().toLocaleTimeString("id-ID")}</div>
    ${customerName ? `<div class="center">Customer: ${customerName}</div>` : ""}
    ${stallName && (!showIdentity || payload.receiptShowStallName !== false) ? `<div class="center">Stall: ${stallName}</div>` : ""}
    ${isPreviewBill ? `<div class="center">PRE-SETTLEMENT · UNPAID</div>` : ""}
    <div class="divider"></div>

    ${!isKitchen && !isBar ? `
      <table>${itemsHtml}</table>
      <div class="divider"></div>
      <div class="row"><span>Subtotal</span><span style="text-align:right">${formatCurrency(receiptSubtotal)}${isArkPayment ? ` / ${formatArkCoin(receiptSubtotal, payload.arkRate)}` : ""}</span></div>
      ${discountRowsHtml}
      ${chargeRowsHtml}
      <div class="row total"><span>TOTAL</span><span style="text-align:right">${formatCurrency(total)}${isArkPayment ? `<br><small style="font-weight:normal;font-size:11px;color:#555">/ ${formatArkCoin(total, payload.arkRate)}</small>` : ""}</span></div>
      ${
        isPreviewBill
          ? `<div class="row"><span>Status</span><span>UNPAID</span></div>
      <div style="margin-top:14px">Disetujui:</div>
      <div style="margin-top:22px">____________________</div>
      <div>Nama: ______________</div>`
          : payload.compType
            ? `<div class="divider"></div>
      <div class="center" style="font-weight:bold">${escapeHtml(compReceiptLabel(payload.compType, payload.compApprovedName) || "COMPLIMENTARY")}</div>`
            : `<div class="row"><span>Bayar (${paymentMethod.toUpperCase()})</span><span>${formatCurrency(total + change)}</span></div>
      ${change > 0 ? `<div class="row"><span>Kembalian</span><span>${formatCurrency(change)}</span></div>` : ""}`
      }
    ` : `
      <table>${itemsHtml}</table>
    `}

    ${
      /* EPIC-041 task 1 — blok ARK, struk customer yang sudah bayar saja */
      isArkPayment
        ? `<div class="divider"></div>
    <div class="row"><span>Harga</span><span>${formatArk(payload.total, payload.arkRate)}</span></div>
    <div class="row"><span>Dibayar ARK</span><span>${formatArk(arkPaidValue, payload.arkRate)}</span></div>
    ${payload.arkBalanceAfter != null ? `<div class="row"><span>Sisa saldo</span><span>${formatArk(payload.arkBalanceAfter, payload.arkRate)} (${formatCurrency(payload.arkBalanceAfter)})</span></div>` : ""}`
        : ""
    }

    ${
      /* EPIC-041 task 2 — XP transaksi + total XP member */
      showIdentity && !isPreviewBill && (payload.xpEarned ?? 0) > 0
        ? `<div class="divider"></div>
    <div class="row"><span>XP didapat</span><span>+${payload.xpEarned} XP</span></div>
    ${payload.xpTotalAfter != null ? `<div class="row"><span>Total XP</span><span>${Math.round(payload.xpTotalAfter).toLocaleString("id-ID")} XP</span></div>` : ""}`
        : ""
    }

    ${
      !isKitchen && !isBar && !isPreviewBill && giftCards && giftCards.length > 0
        ? `<div class="divider"></div>
    <div class="center"><strong>GIFT CARD</strong></div>
    ${giftCards
      .map(
        (card) => `<div class="center" style="margin:4px 0">
      <div style="font-size:15px;font-weight:700;letter-spacing:2px">${card.code}</div>
      <div>Saldo ${formatCurrency(card.initial_value)}</div>
      <div style="font-size:11px">${
        card.expires_at
          ? `Berlaku s/d ${new Date(card.expires_at).toLocaleDateString("id-ID")}`
          : "Tanpa batas waktu"
      }</div>
    </div>`
      )
      .join("")}
    <div class="center" style="font-size:11px">Simpan struk ini — kode berlaku sebagai saldo.</div>`
        : ""
    }

    ${notes ? `<div class="divider"></div>
    <div><strong>Catatan:</strong> ${notes}</div>` : ""}
    ${footerBlockHtml}
    <div class="divider"></div>
    <div class="center">--- ${heading} COPY ---</div>
    ${
      /* QR member portal di paling bawah — hanya struk customer/preview */
      !isKitchen && !isBar
        ? `<div style="margin-top:8px;text-align:center">
      <div style="width:24mm;margin:0 auto">${MEMBER_PORTAL_QR_SVG}</div>
      <div style="font-size:10px;margin-top:3px">${MEMBER_PORTAL_QR_CAPTION}</div>
    </div>`
        : ""
    }
    </div>
  </body>
</html>`;
}

/**
 * EPIC-040 — cache konfigurasi struk di sisi kasir. Satu fetch per menit
 * cukup: konfigurasi jarang berubah, dan print tidak boleh menunggu network
 * lama (fetch gagal = struk tampil tanpa header/footer, bukan gagal print).
 */
let receiptSettingsCache: { rows: Array<Record<string, unknown>>; at: number } | null = null;

async function fetchReceiptSettingsRows(): Promise<Array<Record<string, unknown>>> {
  if (receiptSettingsCache && Date.now() - receiptSettingsCache.at < 60_000) {
    return receiptSettingsCache.rows;
  }
  try {
    const res = await fetch("/api/pos/receipt-settings", { cache: "no-store" });
    const json = await res.json();
    const rows = res.ok && json?.success ? (json.data as Array<Record<string, unknown>>) : [];
    receiptSettingsCache = { rows, at: Date.now() };
    return rows;
  } catch {
    return receiptSettingsCache?.rows ?? [];
  }
}

/**
 * Lengkapi payload dengan header/footer dari konfigurasi bila pemanggil belum
 * mengisinya. Scope diambil dari warehouse item keranjang (satu stall → config
 * stall itu; campuran/kosong → global). Branch-level dilewati di sisi klien —
 * kasir tidak tahu branch id; config per-branch tetap terpakai di jalur WA
 * yang resolve server-side.
 */
/** EPIC-041: kurs ARK utk blok struk — cache 60 dtk, senasib dengan settings struk. */
let arkRateCache: { rate: number; at: number } | null = null;

async function fetchArkRate(): Promise<number> {
  if (arkRateCache && Date.now() - arkRateCache.at < 60_000) return arkRateCache.rate;
  try {
    const res = await fetch("/api/pos/loyalty-settings", { cache: "no-store" });
    const json = await res.json();
    const rate = Number(json?.data?.ark_rate);
    const value = Number.isFinite(rate) && rate > 0 ? rate : 0;
    arkRateCache = { rate: value, at: Date.now() };
    return value;
  } catch {
    return arkRateCache?.rate ?? 0;
  }
}

async function decorateReceiptPayload(payload: ReceiptPayload): Promise<ReceiptPayload> {
  // Kurs ARK diisi terpisah dari header/footer — hanya bila struk memang
  // memuat blok ARK dan pemanggil belum menyuplai kursnya.
  if (isArkCoinMethod(payload.paymentMethod) && payload.arkRate === undefined) {
    payload = { ...payload, arkRate: await fetchArkRate() };
  }
  if (payload.receiptHeader !== undefined || payload.receiptFooter !== undefined) {
    return payload;
  }
  const rows = await fetchReceiptSettingsRows();
  if (rows.length === 0) return payload;
  const warehouseIds = [
    ...new Set(payload.items.map((item) => item.warehouse_id).filter(Boolean)),
  ];
  const settings = resolveReceiptSettings(rows, {
    warehouseId: warehouseIds.length === 1 ? (warehouseIds[0] as string) : null,
  });
  return {
    ...payload,
    receiptHeader: settings.header_lines,
    receiptFooter: settings.footer_lines,
    receiptShowStallName: settings.show_stall_name,
  };
}

export async function printThermalReceipt(rawPayload: ReceiptPayload, label: ThermalPrintLabel) {
  const payload = await decorateReceiptPayload(rawPayload);
  const escPos = buildReceiptEscPosBytes(payload, label);

  // 1) Android Chrome → RawBT ESC/POS intent
  if (canUseRawBtPrint()) {
    if (printBytesViaRawBt(escPos)) {
      toast.success("Print dikirim ke RawBT");
      return;
    }
  }

  // 2) Desktop / paired Web Serial thermal
  try {
    const sent = await printBytesToPairedThermal(escPos);
    if (sent) {
      toast.success("Print");
      return;
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Print langsung gagal, coba jalur lain");
  }

  // 3) Browser print dialog
  printViaPopupWindow(buildReceiptHtml(payload, label));
}
