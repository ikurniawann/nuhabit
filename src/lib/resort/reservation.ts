import { randomInt } from "crypto";
import { formatRupiah } from "@/lib/format";

/**
 * Reservasi resort (owner 2026-09-06): status, kode, dan saldo folio.
 * Semua fungsi murni supaya bisa diuji tanpa database.
 */

export const RESERVATION_STATUSES = [
  "menunggu-bayar", "terkonfirmasi", "check-in", "check-out", "dibatalkan", "no-show",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  "menunggu-bayar": "Menunggu bayar",
  terkonfirmasi: "Terkonfirmasi",
  "check-in": "Sedang menginap",
  "check-out": "Selesai",
  dibatalkan: "Dibatalkan",
  "no-show": "Tidak datang",
};

export const RESERVATION_SOURCES = ["walk-in", "website", "ota", "telepon", "korporat"] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];
export const RESERVATION_SOURCE_LABELS: Record<ReservationSource, string> = {
  "walk-in": "Walk-in", website: "Website", ota: "OTA", telepon: "Telepon", korporat: "Korporat",
};

export const FOLIO_CHARGE_TYPES = [
  "kamar", "extra-bed", "fnb", "aktivitas", "laundry", "denda", "diskon", "pembayaran", "refund",
] as const;
export type FolioChargeType = (typeof FOLIO_CHARGE_TYPES)[number];
export const FOLIO_CHARGE_LABELS: Record<FolioChargeType, string> = {
  kamar: "Kamar", "extra-bed": "Extra bed", fnb: "F&B", aktivitas: "Aktivitas", laundry: "Laundry",
  denda: "Denda", diskon: "Diskon", pembayaran: "Pembayaran", refund: "Refund",
};

/** Jenis biaya yang menambah tagihan (debit); sisanya mengurangi (kredit). */
export function chargeDirection(type: FolioChargeType): "debit" | "kredit" {
  return type === "pembayaran" || type === "diskon" || type === "refund" ? "kredit" : "debit";
}

const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I/O/0/1
export const RESERVATION_CODE_PATTERN = /^RSV-[A-Z0-9]{6}$/;

export function generateReservationCode(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) suffix += CODE_CHARSET[randomInt(CODE_CHARSET.length)];
  return `RSV-${suffix}`;
}

/** Transisi status yang sah — mencegah check-out sebelum check-in, dll. */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  "menunggu-bayar": ["terkonfirmasi", "dibatalkan"],
  terkonfirmasi: ["check-in", "dibatalkan", "no-show"],
  "check-in": ["check-out"],
  "check-out": [],
  dibatalkan: [],
  "no-show": [],
};
export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
/** Reservasi masih memakai kamar (menghalangi tanggal yang sama). */
export function blocksInventory(status: ReservationStatus): boolean {
  return status === "menunggu-bayar" || status === "terkonfirmasi" || status === "check-in";
}
/** Status yang memblokir stok kamar — dipakai query ketersediaan. */
export const INVENTORY_BLOCKING_STATUSES: ReservationStatus[] = RESERVATION_STATUSES.filter(blocksInventory);

export interface FolioLine { direction: "debit" | "kredit"; amount: number | string }

/** Saldo folio: total tagihan − pembayaran. > 0 berarti tamu masih berutang. */
export function folioBalance(lines: readonly FolioLine[]): number {
  return lines.reduce(
    (sum, l) => sum + (l.direction === "debit" ? 1 : -1) * (Number(l.amount) || 0),
    0
  );
}

export function folioTotals(lines: readonly FolioLine[]): { charges: number; payments: number; balance: number } {
  const charges = lines.filter((l) => l.direction === "debit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const payments = lines.filter((l) => l.direction === "kredit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return { charges, payments, balance: charges - payments };
}

/** Validasi tanggal menginap; kembalikan pesan error atau null. */
export function validateStayDates(checkIn: string, checkOut: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(checkIn) || !re.test(checkOut)) return "Format tanggal harus YYYY-MM-DD";
  if (checkOut <= checkIn) return "Tanggal check-out harus setelah check-in";
  return null;
}

/** Pesan ringkas untuk kasir/front office. */
export function reservationSummary(input: {
  code: string; guest: string; nights: number; rooms: number; total: number;
}): string {
  return `${input.code} — ${input.guest}, ${input.rooms} kamar × ${input.nights} malam, total ${formatRupiah(input.total)}`;
}
