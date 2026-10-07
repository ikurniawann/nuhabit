/**
 * Pembangun pesan WA untuk struk & laporan kasir (modul murni, tanpa I/O).
 *
 * Pesan-pesan ini dibaca pelanggan dan owner — format rupiah dan struktur
 * barisnya bagian dari citra bisnis, bukan sekadar log. Pengiriman dilakukan
 * di route handler lewat `sendWhatsAppText`; modul ini hanya menyusun teks
 * supaya bisa diuji tanpa database dan tanpa gateway.
 */

const rupiah = (value: number): string =>
  `${value < 0 ? "-" : ""}Rp ${Math.abs(Math.round(value)).toLocaleString("id-ID")}`;

const jamWib = (iso: string): string =>
  new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu",
  transfer: "Transfer",
  ark_coin: "ARK Coin",
  gift_card: "Gift Card",
  nfc_tab: "Tab Gelang",
};

const metodeBayar = (method: string): string => {
  const mapped = METHOD_LABELS[method.trim().toLowerCase()];
  if (mapped) return mapped;
  return method.trim() || method.replace(/_/g, " ").toUpperCase();
};

/**
 * Normalisasi nomor WA dari input kasir: `08xx`/`+62`/spasi/strip → `628xx`.
 * Nomor yang jelas rusak → null; lebih baik kasir diminta mengetik ulang
 * daripada struk terkirim ke nomor orang lain.
 */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0")
    ? `62${digits.slice(1)}`
    : digits.startsWith("62")
      ? digits
      : `62${digits}`;
  // 62 + minimal 9 digit — di bawah itu bukan nomor ponsel Indonesia yang sah.
  return normalized.length >= 11 && normalized.length <= 16 ? normalized : null;
}

export interface OrderReceiptInput {
  outletName: string;
  orderNumber: string;
  orderedAt: string;
  /**
   * Item struk. `stallName` diisi untuk transaksi gabungan (checkout CHK)
   * supaya pelanggan melihat item SETIAP stall, dikelompokkan per stall.
   */
  items: Array<{
    name: string;
    quantity: number;
    total: number;
    stallName?: string | null;
  }>;
  total: number;
  paymentMethod: string;
  change: number;
  discountAmount?: number;
  customerName?: string | null;
  /**
   * EPIC-040 — baris penutup dari pos_receipt_settings. Absen/kosong =
   * fallback teks lama "Terima kasih atas kunjungan Anda 🙏".
   */
  footerLines?: string[];
}

export function buildOrderReceiptMessage(input: OrderReceiptInput): string {
  const baris: string[] = [
    `*${input.outletName}* — Struk Digital`,
    `No: ${input.orderNumber}`,
    `Waktu: ${jamWib(input.orderedAt)} WIB`,
  ];
  if (input.customerName) baris.push(`Pelanggan: ${input.customerName}`);

  baris.push("");
  // Transaksi gabungan (CHK) memuat item dari beberapa stall — kelompokkan
  // per stall supaya jelas, tapi transaksi satu stall tetap tampil datar.
  const stallNames = [
    ...new Set(
      input.items.map((item) => item.stallName?.trim() || "").filter(Boolean)
    ),
  ];
  if (stallNames.length > 1) {
    for (const stall of stallNames) {
      baris.push(`_${stall}_`);
      for (const item of input.items) {
        if ((item.stallName?.trim() || "") !== stall) continue;
        baris.push(`${item.quantity}x ${item.name} — ${rupiah(item.total)}`);
      }
    }
    // Item tanpa stall (mis. data lama) tetap ikut tercetak, jangan hilang.
    const tanpaStall = input.items.filter((item) => !item.stallName?.trim());
    for (const item of tanpaStall) {
      baris.push(`${item.quantity}x ${item.name} — ${rupiah(item.total)}`);
    }
  } else {
    for (const item of input.items) {
      baris.push(`${item.quantity}x ${item.name} — ${rupiah(item.total)}`);
    }
  }
  baris.push("");

  if (input.discountAmount && input.discountAmount > 0) {
    baris.push(`Diskon: ${rupiah(input.discountAmount)}`);
  }
  baris.push(`*Total: ${rupiah(input.total)}*`);
  baris.push(`Pembayaran: ${metodeBayar(input.paymentMethod)}`);
  if (input.change > 0) baris.push(`Kembalian: ${rupiah(input.change)}`);

  const footer =
    input.footerLines && input.footerLines.length > 0
      ? input.footerLines
      : ["Terima kasih atas kunjungan Anda 🙏"];
  baris.push("", ...footer);
  return baris.join("\n");
}

export interface TopupReceiptInput {
  outletName: string;
  customerName: string;
  amount: number;
  method: string;
  /** null = saldo akhir tidak diketahui — barisnya disembunyikan, bukan "Rp 0". */
  balanceAfter: number | null;
  at: string;
}

export function buildTopupReceiptMessage(input: TopupReceiptInput): string {
  const baris = [
    `*${input.outletName}* — Bukti Top-Up`,
    `Pelanggan: ${input.customerName}`,
    `Waktu: ${jamWib(input.at)} WIB`,
    "",
    `*Top-up: ${rupiah(input.amount)}*`,
    `Metode: ${metodeBayar(input.method)}`,
  ];
  if (input.balanceAfter !== null) {
    baris.push(`Saldo sekarang: ${rupiah(input.balanceAfter)}`);
  }
  baris.push("", "Terima kasih 🙏");
  return baris.join("\n");
}

export interface ShiftReportInput {
  outletName: string;
  shiftNumber: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  totalOrders: number;
  totalSales: number;
  openingCash: number;
  expectedCash: number;
  closingCash: number;
  variance: number;
}

export function buildShiftReportMessage(input: ShiftReportInput): string {
  // Selisih adalah angka yang paling ditunggu owner — ditaruh paling bawah
  // dengan kata yang jujur: "pas", "lebih", atau "kurang".
  const selisih =
    input.variance === 0
      ? "pas ✅"
      : input.variance > 0
        ? `lebih ${rupiah(input.variance)}`
        : `kurang ${rupiah(input.variance)} ⚠️`;

  return [
    `*Laporan Tutup Kasir — ${input.outletName}*`,
    `Shift: ${input.shiftNumber}`,
    `Kasir: ${input.cashierName}`,
    `Buka: ${jamWib(input.openedAt)} WIB`,
    `Tutup: ${jamWib(input.closedAt)} WIB`,
    "",
    `Jumlah transaksi: ${input.totalOrders}`,
    `*Total penjualan: ${rupiah(input.totalSales)}*`,
    "",
    `Kas awal: ${rupiah(input.openingCash)}`,
    `Kas seharusnya: ${rupiah(input.expectedCash)}`,
    `Kas fisik: ${rupiah(input.closingCash)}`,
    `Selisih: ${selisih}`,
  ].join("\n");
}

export interface MemberBillReminderInput {
  outletName: string;
  customerName: string;
  at: string;
  /** Order belum lunas, urut terlama dulu. */
  orders: { orderNumber: string; orderedAt: string; total: number }[];
  openTotal: number;
  /** Saldo cicilan yang sudah masuk (belum menutup order). */
  paid: number;
  outstanding: number;
}

/** Maks. baris order di pesan WA — sisanya diringkas supaya pesan tetap pendek. */
export const MEMBER_BILL_WA_MAX_ORDERS = 15;

const tanggalWib = (iso: string): string =>
  new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

/** Pesan WA rincian Tagihan Member (POS → Tagihan → Kirim WA, owner 2026-10-01). */
export function buildMemberBillReminderMessage(input: MemberBillReminderInput): string {
  const shown = input.orders.slice(0, MEMBER_BILL_WA_MAX_ORDERS);
  const hidden = input.orders.length - shown.length;
  const baris = [
    `Halo *${input.customerName}* 👋`,
    `Berikut rincian tagihan Anda di *${input.outletName}* per ${jamWib(input.at)} WIB:`,
    "",
    ...shown.map(
      (order, index) => `${index + 1}. ${order.orderNumber} · ${tanggalWib(order.orderedAt)} — ${rupiah(order.total)}`
    ),
  ];
  if (hidden > 0) baris.push(`… dan ${hidden} order lainnya`);
  baris.push("", `Total order: ${rupiah(input.openTotal)}`);
  if (input.paid > 0) baris.push(`Sudah dibayar: ${rupiah(input.paid)}`);
  baris.push(
    `*Sisa tagihan: ${rupiah(input.outstanding)}*`,
    "",
    "Pembayaran bisa dilakukan di kasir dan boleh dicicil. Terima kasih 🙏"
  );
  return baris.join("\n");
}
