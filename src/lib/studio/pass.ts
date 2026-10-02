/**
 * Logika murni Member Pass (EPIC-053) — tanpa DB supaya mudah diuji.
 *
 * Uang dihitung dalam SEN (integer) lalu dikembalikan sebagai rupiah 2 desimal,
 * supaya alokasi nilai per kredit tidak menumpuk selisih pembulatan.
 */

import { addDays } from "./schedule";

export const PASS_CATEGORIES = ["class", "class_pt", "class_pt_facility"] as const;
export type PassCategory = (typeof PASS_CATEGORIES)[number];
export const PASS_CATEGORY_LABEL: Record<PassCategory, string> = {
  class: "Class",
  class_pt: "Class + PT",
  class_pt_facility: "Class + PT + Facility",
};

export const PASS_STATUSES = ["pending_payment", "active", "expired", "exhausted", "cancelled"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];
export const PASS_STATUS_LABEL: Record<PassStatus | "scheduled", string> = {
  pending_payment: "Menunggu bayar",
  active: "Aktif",
  scheduled: "Belum mulai",
  expired: "Kedaluwarsa",
  exhausted: "Kredit habis",
  cancelled: "Dibatalkan",
};

export const PAYMENT_METHODS = ["cash", "qris", "card", "transfer", "complimentary"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod | "xendit", string> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu debit/kredit",
  transfer: "Transfer bank",
  complimentary: "Komplimen",
  xendit: "Online (Xendit)",
};

const toCents = (rupiah: number) => Math.round(rupiah * 100);
const toRupiah = (cents: number) => cents / 100;

/**
 * Nilai rupiah untuk `qty` kredit berikutnya, dihitung kumulatif:
 * alokasi(n) = round(total × n / kredit). Jumlah semua redeem = total persis,
 * berapa pun pembagiannya (mis. Rp 1.000.000 / 3 kredit = 333.333,33 ×2 + 333.333,34).
 */
export function allocateCreditValue(totalValue: number, totalCredits: number, usedBefore: number, qty = 1): number {
  if (totalCredits <= 0 || qty <= 0) return 0;
  const total = toCents(totalValue);
  const from = Math.min(Math.max(usedBefore, 0), totalCredits);
  const to = Math.min(from + qty, totalCredits);
  const at = (n: number) => Math.round((total * n) / totalCredits);
  return toRupiah(at(to) - at(from));
}

/** Nilai yang belum diakui untuk satu jenis kredit. */
export function remainingCreditValue(totalValue: number, totalCredits: number, used: number): number {
  if (totalCredits <= 0) return 0;
  return allocateCreditValue(totalValue, totalCredits, used, totalCredits - used);
}

/**
 * Usulan pembagian harga ke kelas/PT/facility: rata per sesi (kelas & PT),
 * facility 0 (diakui saat kedaluwarsa). Admin boleh menyesuaikan, asal total = harga.
 */
export function suggestValueSplit(price: number, classCredits: number, ptCredits: number, facility: boolean) {
  const total = toCents(price);
  const sessions = classCredits + ptCredits;
  if (sessions === 0) return { class_value: 0, pt_value: 0, facility_value: facility ? price : 0 };
  const pt = Math.round((total * ptCredits) / sessions);
  return { class_value: toRupiah(total - pt), pt_value: toRupiah(pt), facility_value: 0 };
}

export function isValueSplitValid(p: {
  price: number;
  class_value: number;
  pt_value: number;
  facility_value: number;
  class_credits: number;
  pt_credits: number;
  facility_access: boolean;
}): string | null {
  if (p.class_credits + p.pt_credits <= 0 && !p.facility_access) return "Paket harus berisi kredit kelas, kredit PT, atau akses facility";
  if (toCents(p.class_value) + toCents(p.pt_value) + toCents(p.facility_value) !== toCents(p.price)) {
    return "Pembagian nilai kelas + PT + facility harus sama dengan harga";
  }
  if (p.class_value > 0 && p.class_credits <= 0) return "Nilai kelas diisi tetapi paket tidak punya kredit kelas";
  if (p.pt_value > 0 && p.pt_credits <= 0) return "Nilai PT diisi tetapi paket tidak punya kredit PT";
  if (p.facility_value > 0 && !p.facility_access) return "Nilai facility diisi tetapi paket tanpa akses facility";
  return null;
}

/** Tanggal berakhir: valid_from + masa berlaku − 1 + hari freeze. */
export function computeValidUntil(validFrom: string, validityDays: number, frozenDays = 0): string {
  return addDays(validFrom, validityDays - 1 + frozenDays);
}

export interface PassBalance {
  class_total: number;
  pt_total: number;
  class_used: number;
  pt_used: number;
}

export function remainingCredits(b: PassBalance) {
  return { class: Math.max(b.class_total - b.class_used, 0), pt: Math.max(b.pt_total - b.pt_used, 0) };
}

/**
 * Status efektif untuk ditampilkan/dipakai booking. Status tersimpan hanya
 * memegang keputusan manusia/sistem (bayar, batal, expire job); tanggal &
 * saldo dievaluasi di sini.
 */
export function effectivePassStatus(
  p: { status: PassStatus; valid_from: string; valid_until: string; facility_access: boolean },
  balance: PassBalance,
  today: string
): PassStatus | "scheduled" {
  if (p.status === "cancelled" || p.status === "pending_payment") return p.status;
  if (p.status === "expired" || today > p.valid_until) return "expired";
  const left = remainingCredits(balance);
  if (left.class === 0 && left.pt === 0 && !p.facility_access && balance.class_total + balance.pt_total > 0) return "exhausted";
  if (today < p.valid_from) return "scheduled";
  return "active";
}

/**
 * Nilai yang sudah dipindah dari utang ke revenue, per jenis — diambil dari
 * ledger (amount redeem − unredeem + expire). Penyesuaian kredit manual TIDAK
 * memindah nilai (tidak ada jurnalnya), jadi tidak dihitung di sini.
 */
export interface PassRecognized {
  class: number;
  pt: number;
  facility: number;
}

/**
 * Utang tersisa = harga dibayar − nilai yang sudah diakui. Dihitung dari NILAI,
 * bukan sisa kredit, supaya selalu sama dengan saldo akun PASS_LIABILITY di
 * buku besar (penyesuaian kredit manual tidak menggeser angka ini).
 */
export function outstandingLiability(
  p: { price_paid: number; status: PassStatus; breakage_recognized: boolean },
  recognized: PassRecognized
): number {
  if (p.status === "cancelled" || p.status === "pending_payment" || p.breakage_recognized) return 0;
  const cents = toCents(p.price_paid) - toCents(recognized.class) - toCents(recognized.pt) - toCents(recognized.facility);
  return toRupiah(Math.max(cents, 0));
}

/**
 * Nilai redeem kredit berikutnya: alokasi kumulatif atas jumlah kredit yang
 * SUDAH di-redeem (bukan saldo setelah penyesuaian). Kredit kompensasi di luar
 * kuota paket bernilai 0.
 */
export function redeemValue(totalValue: number, totalCredits: number, redeemedBefore: number, qty = 1): number {
  return allocateCreditValue(totalValue, totalCredits, redeemedBefore, qty);
}

/** Rincian nilai yang diakui saat pass kedaluwarsa: semua sisa nilai + facility. */
export function breakageOnExpiry(
  p: { class_value: number; pt_value: number; facility_value: number },
  b: PassBalance,
  recognized: PassRecognized
) {
  const left = remainingCredits(b);
  return {
    class_qty: left.class,
    class_amount: toRupiah(Math.max(toCents(p.class_value) - toCents(recognized.class), 0)),
    pt_qty: left.pt,
    pt_amount: toRupiah(Math.max(toCents(p.pt_value) - toCents(recognized.pt), 0)),
    facility_amount: toRupiah(Math.max(toCents(p.facility_value) - toCents(recognized.facility), 0)),
  };
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Kode pass pendek & mudah dibaca, mis. NH-7K2QXM (tanpa 0/O/1/I). */
export function generatePassCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `NH-${out}`;
}
