// EPIC-034 Fase A — lib murni gift card (tanpa DB): kode CSPRNG, matematika
// saldo, evaluasi redeem. Beda dari promo.promo_codes (potongan sekali
// pakai): gift card = uang titipan, saldo bisa dipakai berkali-kali
// (partial redeem) sampai habis.

import { randomInt } from "crypto";

// Charset anti-ambigu (tanpa 0/O/1/I) — pola generateVoucherCode EPIC-032
const GIFT_CARD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GIFT_CARD_CODE_LENGTH = 12;

/**
 * Kode bearer gift card: 12 char CSPRNG, tanpa PIN (keputusan owner 26 Jul —
 * kode saja utk MVP). Bearer = uang; wajib crypto.randomInt, bukan
 * Math.random.
 */
export function generateGiftCardCode(): string {
  let code = "";
  for (let i = 0; i < GIFT_CARD_CODE_LENGTH; i++) {
    code += GIFT_CARD_CHARSET[randomInt(GIFT_CARD_CHARSET.length)];
  }
  return code;
}

const CODE_FORMAT = /^[A-Z0-9]{8,20}$/;

export function isValidGiftCardCodeFormat(code: string): boolean {
  return CODE_FORMAT.test(code);
}

export type GiftCardStatus =
  | "pending"
  | "active"
  | "disabled"
  | "exhausted"
  | "expired";

export interface GiftCardState {
  status: GiftCardStatus;
  balance: number;
  /** ISO date/timestamp atau Date dari node-postgres; null = tanpa kedaluwarsa. */
  expiresAt: string | Date | null;
}

export type GiftCardRejectReason =
  | "nonaktif"
  | "kedaluwarsa"
  | "saldo-kurang"
  | "nominal-tidak-valid";

export type GiftCardRedeemResult =
  | { ok: true; balanceAfter: number; statusAfter: GiftCardStatus }
  | { ok: false; reason: GiftCardRejectReason };

export const GIFT_CARD_REJECT_MESSAGES: Record<GiftCardRejectReason, string> = {
  nonaktif: "Gift card tidak aktif atau belum bisa dipakai",
  kedaluwarsa: "Gift card sudah kedaluwarsa",
  "saldo-kurang": "Saldo gift card tidak cukup",
  "nominal-tidak-valid": "Nominal harus lebih dari 0",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Bandingkan sebagai waktu: node-postgres mengembalikan timestamptz sebagai Date. */
export function isGiftCardExpired(
  expiresAt: string | Date | null,
  now: string
): boolean {
  if (expiresAt === null) return false;
  return new Date(now).getTime() > new Date(expiresAt).getTime();
}

/**
 * Evaluasi redeem satu kartu (dipakai kasir Fase C — full-cover only sesuai
 * keputusan owner "1 transaksi 1 metode"; pemanggil yang memastikan amount =
 * total transaksi). Fungsi ini murni menjaga invarian saldo & status.
 */
export function evaluateGiftCardRedeem(
  card: GiftCardState,
  amount: number,
  now: string
): GiftCardRedeemResult {
  if (amount <= 0) return { ok: false, reason: "nominal-tidak-valid" };
  if (card.status === "disabled" || card.status === "exhausted" || card.status === "pending") {
    return { ok: false, reason: "nonaktif" };
  }
  if (card.status === "expired" || isGiftCardExpired(card.expiresAt, now)) {
    return { ok: false, reason: "kedaluwarsa" };
  }
  if (card.balance < amount) {
    return { ok: false, reason: "saldo-kurang" };
  }
  const balanceAfter = round2(card.balance - amount);
  return {
    ok: true,
    balanceAfter,
    statusAfter: balanceAfter <= 0 ? "exhausted" : "active",
  };
}

/** Saldo setelah terbit/top-up (ledger direction 'isi'). */
export function computeBalanceAfterIssue(
  currentBalance: number,
  amount: number
): number {
  if (amount <= 0) throw new Error("Nominal isi harus > 0");
  return round2(currentBalance + amount);
}

/** Saldo setelah koreksi manual admin (ledger direction 'koreksi'). */
export function computeBalanceAfterCorrection(
  currentBalance: number,
  delta: number
): number {
  const result = round2(currentBalance + delta);
  if (result < 0) throw new Error("Koreksi membuat saldo negatif");
  return result;
}

// ── Fase B — konfigurasi nominal & masa berlaku ────────────────────────
// Keputusan owner #4 (26 Jul): nominal preset dan expiry CONFIGURABLE per
// tenant lewat app_settings, bukan angka tetap di kode. Nilai rusak jatuh
// ke default aman (pola parseCampaignConfig EPIC-033).

export interface GiftCardConfig {
  /** Nominal preset yang ditawarkan kasir saat menjual gift card. */
  presets: number[];
  /** Kasir boleh mengetik nominal bebas di luar preset. */
  allow_custom: boolean;
  /** Masa berlaku sejak terbit; null = tanpa kedaluwarsa. */
  expiry_months: number | null;
}

export const DEFAULT_GIFT_CARD_CONFIG: GiftCardConfig = {
  presets: [50_000, 100_000, 200_000, 500_000],
  allow_custom: true,
  expiry_months: null,
};

const MAX_PRESETS = 12;
const MAX_EXPIRY_MONTHS = 120;

export function parseGiftCardConfig(raw: unknown): GiftCardConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const presets = Array.isArray(obj.presets)
    ? [
        ...new Set(
          obj.presets.filter(
            (v): v is number =>
              typeof v === "number" && Number.isFinite(v) && v > 0
          )
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, MAX_PRESETS)
    : [];

  const expiryMonths =
    typeof obj.expiry_months === "number" && Number.isFinite(obj.expiry_months)
      ? Math.min(MAX_EXPIRY_MONTHS, Math.max(1, Math.floor(obj.expiry_months)))
      : null;

  return {
    presets: presets.length > 0 ? presets : DEFAULT_GIFT_CARD_CONFIG.presets,
    allow_custom:
      typeof obj.allow_custom === "boolean"
        ? obj.allow_custom
        : DEFAULT_GIFT_CARD_CONFIG.allow_custom,
    expiry_months: expiryMonths,
  };
}

/** Plafon aman satu kartu — menahan salah ketik nol di kasir. */
export const MAX_GIFT_CARD_VALUE = 100_000_000;

/**
 * Nominal penjualan gift card yang boleh diterima SERVER. Klien tidak
 * dipercaya: kasir mengirim harga, server memvalidasi ulang terhadap
 * konfigurasi (preset vs nominal bebas). Saldo selalu rupiah bulat.
 */
export function isAllowedGiftCardNominal(
  config: GiftCardConfig,
  nominal: number
): boolean {
  if (!Number.isFinite(nominal) || !Number.isInteger(nominal)) return false;
  if (nominal <= 0 || nominal > MAX_GIFT_CARD_VALUE) return false;
  if (config.allow_custom) return true;
  return config.presets.includes(nominal);
}

/**
 * Tanggal kedaluwarsa kartu = tanggal terbit + N bulan. Tanggal akhir bulan
 * dijepit supaya 31 Jan + 1 bulan = 28/29 Feb, bukan meluber ke Maret
 * (perilaku bawaan setUTCMonth).
 */
export function resolveGiftCardExpiry(
  expiryMonths: number | null,
  issuedAtIso: string
): string | null {
  if (expiryMonths === null) return null;
  const issued = new Date(issuedAtIso);
  const dayOfMonth = issued.getUTCDate();
  const expiry = new Date(issued);
  expiry.setUTCDate(1); // hindari overflow saat pindah bulan
  expiry.setUTCMonth(expiry.getUTCMonth() + expiryMonths);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)
  ).getUTCDate();
  expiry.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return expiry.toISOString();
}

// ── Fase C — void order mengembalikan saldo ────────────────────────────

/**
 * Status kartu setelah saldo dikembalikan (void order). Kartu yang sempat
 * `exhausted` hidup lagi, tetapi kartu yang DIMATIKAN admin atau sudah
 * kedaluwarsa tidak boleh ikut aktif kembali hanya karena ada refund.
 */
export function resolveStatusAfterRefund(
  currentStatus: GiftCardStatus,
  balanceAfter: number
): GiftCardStatus {
  if (currentStatus === "disabled" || currentStatus === "expired") {
    return currentStatus;
  }
  return balanceAfter > 0 ? "active" : "exhausted";
}

// ── Reload (top up) kartu yang sudah ada ───────────────────────────────

export type GiftCardReloadRejectReason =
  | "nominal-tidak-valid"
  | "nonaktif"
  | "kedaluwarsa"
  | "melebihi-plafon";

export const GIFT_CARD_RELOAD_REJECT_MESSAGES: Record<GiftCardReloadRejectReason, string> = {
  "nominal-tidak-valid": "Nominal reload harus rupiah bulat di atas 0",
  nonaktif: "Kartu nonaktif atau belum dibayar — tidak bisa di-reload",
  kedaluwarsa: "Kartu sudah kedaluwarsa — tidak bisa di-reload",
  "melebihi-plafon": `Saldo setelah reload melebihi plafon Rp${MAX_GIFT_CARD_VALUE.toLocaleString("id-ID")}`,
};

export type GiftCardReloadResult =
  | {
      ok: true;
      balanceAfter: number;
      reloadedTotalAfter: number;
      statusAfter: GiftCardStatus;
    }
  | { ok: false; reason: GiftCardReloadRejectReason };

/**
 * Reload menambah saldo kartu `active` atau `exhausted` (kartu habis hidup
 * lagi). Kartu `disabled`/`pending`/`expired` ditolak: reload bukan jalan
 * pintas mengaktifkan kartu yang dimatikan admin. `reloaded_total` ikut
 * naik supaya batas saldo (nilai terbit + total reload) tetap terjaga.
 */
export function evaluateGiftCardReload(
  card: GiftCardState & { reloadedTotal: number },
  amount: number,
  now: string
): GiftCardReloadResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "nominal-tidak-valid" };
  }
  if (card.status !== "active" && card.status !== "exhausted") {
    return { ok: false, reason: card.status === "expired" ? "kedaluwarsa" : "nonaktif" };
  }
  if (isGiftCardExpired(card.expiresAt, now)) {
    return { ok: false, reason: "kedaluwarsa" };
  }
  const balanceAfter = computeBalanceAfterIssue(card.balance, amount);
  if (balanceAfter > MAX_GIFT_CARD_VALUE) {
    return { ok: false, reason: "melebihi-plafon" };
  }
  return {
    ok: true,
    balanceAfter,
    reloadedTotalAfter: round2(card.reloadedTotal + amount),
    statusAfter: "active",
  };
}

// ── Pencocokan nomor HP (tautan kartu ↔ member) ────────────────────────

/** Digit nomor HP tanpa awalan 0/62: "0812-3", "+62 8123", "628123" → "8123". */
export function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^(62|0)/, "");
}

/** Padanan SQL `phoneMatchKey` untuk kolom teks. */
export function phoneMatchKeySql(column: string): string {
  return `regexp_replace(regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g'), '^(62|0)', '')`;
}
