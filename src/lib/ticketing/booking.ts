// Fase D — Website Booking: helper murni booking online (status machine,
// kode booking, capability token, jendela tanggal). Tanpa DB supaya mudah
// diuji; pemakaian di route API publik /api/public/booking/*.

import { randomBytes, randomInt } from "crypto";
import { addDaysIso } from "./calendar";
import { isValidCalendarDate } from "./pricing";

export const BOOKING_STATUSES = [
  "menunggu-bayar",
  "terbayar",
  "digunakan",
  "kedaluwarsa",
  "dibatalkan",
  "hangus",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// menunggu-bayar → terbayar (webhook PAID) | kedaluwarsa (invoice expired)
//                → dibatalkan (admin); terbayar → digunakan (redeem loket)
//                → dibatalkan (refund manual) → hangus (lewat masa berlaku
//                redeem — pengakuan pendapatan hangus, keputusan owner
//                2026-07-23). Terminal: empat sisanya — hangus TIDAK
//                dibangkitkan (uangnya sudah lama masuk; koreksi = manual).
const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  "menunggu-bayar": ["terbayar", "kedaluwarsa", "dibatalkan"],
  terbayar: ["digunakan", "dibatalkan", "hangus"],
  digunakan: [],
  kedaluwarsa: [],
  dibatalkan: [],
  hangus: [],
};

export function canTransitionBooking(
  from: BookingStatus,
  to: BookingStatus
): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

// Charset tanpa 0/O/1/I/L — kode dibacakan lewat telepon/WA dan diketik
// petugas loket; salah baca huruf ambigu = antrian tertahan.
const BOOKING_CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BOOKING_CODE_LENGTH = 6;

const BOOKING_CODE_PATTERN = /^BK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/**
 * Normalisasi input petugas loket (ketik manual / hasil scan QR):
 * huruf besar, spasi dibuang, prefix BK- boleh tertinggal. Null bila
 * hasilnya tetap bukan kode booking yang sah.
 */
export function normalizeBookingCode(raw: string): string | null {
  let code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!code.startsWith("BK-")) {
    code = code.startsWith("BK") ? `BK-${code.slice(2)}` : `BK-${code}`;
  }
  return BOOKING_CODE_PATTERN.test(code) ? code : null;
}

/** Kode pendek human-friendly (BK-XXXXXX); tabrakan ditangani retry 23505. */
export function generateBookingCode(): string {
  let suffix = "";
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    suffix += BOOKING_CODE_CHARSET[randomInt(BOOKING_CODE_CHARSET.length)];
  }
  return `BK-${suffix}`;
}

/** Capability token halaman status publik — 32 byte acak, hex. */
export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export const BOOKING_MAX_DAYS_AHEAD = 90;

/** Batas tiket per booking — dipakai create publik DAN redeem loket. */
export const BOOKING_MAX_QTY = 20;

export type VisitDateWindowResult =
  | "ok"
  | "masa-lalu"
  | "terlalu-jauh"
  | "tidak-valid";

/** Jendela booking: hari ini s/d +BOOKING_MAX_DAYS_AHEAD (inklusif). */
export function validateVisitDateWindow(
  visitDate: string,
  today: string
): VisitDateWindowResult {
  if (!isValidCalendarDate(visitDate)) return "tidak-valid";
  if (visitDate < today) return "masa-lalu";
  if (visitDate > addDaysIso(today, BOOKING_MAX_DAYS_AHEAD)) return "terlalu-jauh";
  return "ok";
}

const VISIT_DATE_WINDOW_ERRORS: Record<Exclude<VisitDateWindowResult, "ok">, string> = {
  "masa-lalu": "Tanggal kunjungan sudah lewat",
  "terlalu-jauh": "Tanggal kunjungan terlalu jauh ke depan",
  "tidak-valid": "Tanggal kunjungan tidak valid",
};

/** Pesan galat jendela tanggal kunjungan (null = boleh dipesan). */
export function visitDateWindowError(visitDate: string, today: string): string | null {
  const window = validateVisitDateWindow(visitDate, today);
  return window === "ok" ? null : VISIT_DATE_WINDOW_ERRORS[window];
}

/**
 * Jendela redeem booking terbayar (keputusan owner 2026-07-23): hari-H s/d
 * H + forfeitDays. forfeitDays NULL (kebijakan belum diisi di Pengaturan
 * Tiket) = perilaku lama: hanya hari-H, tidak pernah hangus.
 */
export function redeemWindowStatus(
  visitDate: string,
  today: string,
  forfeitDays: number | null
): "belum-mulai" | "boleh" | "lewat" {
  if (today < visitDate) return "belum-mulai";
  const lastDay =
    forfeitDays === null ? visitDate : addDaysIso(visitDate, forfeitDays);
  return today <= lastDay ? "boleh" : "lewat";
}

/**
 * Layak dihanguskan? Hanya bila kebijakan sudah diisi DAN masa berlaku
 * redeem sudah lewat. NULL = jangan pernah menghanguskan.
 */
export function isForfeitDue(
  visitDate: string,
  today: string,
  forfeitDays: number | null
): boolean {
  if (forfeitDays === null) return false;
  return redeemWindowStatus(visitDate, today, forfeitDays) === "lewat";
}

/** Tanggal hari ini menurut zona venue (WIB) — bukan UTC server. */
export function todayInJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ── Rombongan bernama (Fase D — revisi owner) ────────────────────────
// Tiap unit tiket dalam booking = satu "guest" bernama. Nama boleh
// dikosongkan pemesan; default: posisi 1 = nama pemesan, sisanya
// "Group {pemesan} - {posisi}" (penomoran global lintas item).

export const GUEST_NAME_MAX_LENGTH = 120;

/**
 * Susun nama anggota rombongan final (panjang = totalQty). `provided`
 * adalah input pemesan per posisi (boleh kurang panjang / null / kosong);
 * yang kosong diisi default. Nama dipotong ke batas kolom.
 */
export function buildGuestNames(
  customerName: string,
  totalQty: number,
  provided: readonly (string | null | undefined)[] = []
): string[] {
  const base = customerName.trim();
  const names: string[] = [];
  for (let position = 1; position <= totalQty; position++) {
    const raw = provided[position - 1]?.trim() ?? "";
    const fallback = position === 1 ? base : `Group ${base} - ${position}`;
    names.push((raw || fallback).slice(0, GUEST_NAME_MAX_LENGTH));
  }
  return names;
}

// ── Redeem loket (Fase D4) ────────────────────────────────────────────
// Booking terbayar ditukar gelang di loket: SETIAP anggota rombongan
// harus dapat tepat satu gelang — kurang/dobel/guest asing ditolak
// supaya tiket yang dibayar = tiket yang dipakai.

export type MatchRedeemGuestsResult =
  | { ok: true }
  | {
      ok: false;
      reason: "guest-asing" | "guest-dobel" | "belum-lengkap";
      guest_id: string | null;
    };

/** Validasi pairing gelang↔anggota: bijeksi penuh terhadap daftar guest. */
export function matchRedeemGuests(
  guestIds: readonly string[],
  bands: readonly { guest_id: string }[]
): MatchRedeemGuestsResult {
  const remaining = new Set(guestIds);
  for (const band of bands) {
    if (!guestIds.includes(band.guest_id)) {
      return { ok: false, reason: "guest-asing", guest_id: band.guest_id };
    }
    if (!remaining.delete(band.guest_id)) {
      return { ok: false, reason: "guest-dobel", guest_id: band.guest_id };
    }
  }
  if (remaining.size > 0) {
    return {
      ok: false,
      reason: "belum-lengkap",
      guest_id: remaining.values().next().value ?? null,
    };
  }
  return { ok: true };
}
