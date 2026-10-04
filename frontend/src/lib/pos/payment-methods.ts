export type PosPaymentMethodCode =
  | "cash"
  | "qris"
  | "credit_card"
  | "ark_coin"
  | "nfc_tab"
  | "gift_card";

export type PosPaymentHandler =
  | "cash"
  | "qris"
  | "credit"
  | "ark_wallet"
  | "nfc_tab"
  | "gift_card";

export type PosPaymentMethod = {
  id: string;
  /** Kode bawaan (union di atas) ATAU slug metode kustom buatan admin */
  code: string;
  name: string;
  description: string;
  icon: string;
  handler: PosPaymentHandler;
  is_active: boolean;
  sort_order: number;
  requires_cash_input: boolean;
};

/** Handler yang boleh dipilih saat tambah metode manual (bukan Xendit/QRIS). */
export const MANUAL_PAYMENT_HANDLERS = ["cash", "credit"] as const;
export type ManualPaymentHandler = (typeof MANUAL_PAYMENT_HANDLERS)[number];

export const POS_PAYMENT_HANDLERS: PosPaymentHandler[] = [
  "cash",
  "qris",
  "credit",
  "ark_wallet",
  "nfc_tab",
  "gift_card",
];

export const POS_PAYMENT_METHOD_CODES: PosPaymentMethodCode[] = [
  "cash",
  "qris",
  "credit_card",
  "ark_coin",
  "nfc_tab",
  "gift_card",
];

/** Kode bawaan ber-alur khusus — tidak boleh dihapus dari master. */
export const PROTECTED_PAYMENT_METHOD_CODES = new Set<string>(
  POS_PAYMENT_METHOD_CODES
);

/** Slug kode metode (bawaan maupun kustom): huruf kecil/angka/-/_ 2-40. */
export const PAYMENT_METHOD_CODE_PATTERN = /^[a-z0-9_-]{2,40}$/;

export function isValidPaymentMethodCode(code: string): boolean {
  return PAYMENT_METHOD_CODE_PATTERN.test(code);
}

/** Fallback jika tabel belum ada / API gagal — sama dengan seed. */
export const DEFAULT_POS_PAYMENT_METHODS: PosPaymentMethod[] = [
  {
    id: "fallback-cash",
    code: "cash",
    name: "Cash",
    description: "Pay with cash",
    icon: "banknote",
    handler: "cash",
    is_active: true,
    sort_order: 10,
    requires_cash_input: true,
  },
  {
    id: "fallback-qris",
    code: "qris",
    name: "QRIS",
    description: "Scan QR code",
    icon: "qr-code",
    handler: "qris",
    is_active: true,
    sort_order: 20,
    requires_cash_input: false,
  },
  {
    id: "fallback-credit",
    code: "credit_card",
    name: "Credit Card",
    description: "Visa / Mastercard",
    icon: "credit-card",
    handler: "credit",
    is_active: true,
    sort_order: 30,
    requires_cash_input: false,
  },
  {
    id: "fallback-ark",
    code: "ark_coin",
    name: "ARK Coin",
    description: "Member balance",
    icon: "coins",
    handler: "ark_wallet",
    is_active: true,
    sort_order: 40,
    requires_cash_input: false,
  },
  {
    id: "fallback-nfc",
    code: "nfc_tab",
    name: "NFC Tab",
    description: "Gelang ticketing",
    icon: "ticket",
    handler: "nfc_tab",
    is_active: true,
    sort_order: 50,
    requires_cash_input: false,
  },
  {
    id: "fallback-gift",
    code: "gift_card",
    name: "Gift Card",
    description: "Saldo kartu hadiah",
    icon: "gift",
    handler: "gift_card",
    is_active: true,
    sort_order: 60,
    requires_cash_input: false,
  },
];

export function isPosPaymentMethodCode(value: string): value is PosPaymentMethodCode {
  return (POS_PAYMENT_METHOD_CODES as string[]).includes(value);
}

export function isPosPaymentHandler(value: string): value is PosPaymentHandler {
  return (POS_PAYMENT_HANDLERS as string[]).includes(value);
}

export function isManualPaymentHandler(value: string): value is ManualPaymentHandler {
  return (MANUAL_PAYMENT_HANDLERS as readonly string[]).includes(value);
}

/** Alur kasir dari handler — kode katalog custom tetap memakai handler ini. */
export function cashierMethodFromHandler(
  handler: string
): PosPaymentMethodCode {
  if (handler === "credit") return "credit_card";
  if (handler === "ark_wallet") return "ark_coin";
  if (handler === "qris") return "qris";
  if (handler === "nfc_tab") return "nfc_tab";
  if (handler === "gift_card") return "gift_card";
  return "cash";
}

export function canRenamePaymentMethodCode(code: string) {
  return !isPosPaymentMethodCode(code);
}

export function slugifyPaymentMethodCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function sanitizePaymentMethodCode(value?: string | null) {
  return slugifyPaymentMethodCode(String(value || "")) || null;
}

export function sanitizePaymentMethodName(value?: string | null) {
  const trimmed = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return trimmed || null;
}

export function resolvePaymentCatalogStamp(input: {
  code?: string | null;
  name?: string | null;
}) {
  return {
    payment_method_code: sanitizePaymentMethodCode(input.code),
    payment_method_name: sanitizePaymentMethodName(input.name),
  };
}

/** Laci tunai hanya untuk kode built-in `cash`, bukan alias custom (Transfer BCA). */
export function isDrawerCashMethod(input: {
  paymentMethodCode?: string | null;
  paymentMethod?: string | null;
}) {
  const code = String(input.paymentMethodCode || "").trim().toLowerCase();
  if (code) return code === "cash";
  return String(input.paymentMethod || "").trim().toLowerCase() === "cash";
}

/**
 * Metode FOC (Free of Charge) — metode kustom buatan admin yang menandai
 * tagihan digratiskan. Keputusan owner 2026-08-24: pemakaiannya WAJIB
 * disetujui PIN supervisor (gerbang di server, penyetuju tercatat di
 * comp_approved_by/name). Dicocokkan dari kode ATAU nama karena metode
 * kustom bebas dinamai admin ("FOC", "F.O.C", "Free of Charge").
 */
const FOC_CODE_RE = /^foc$|^free[_-]?of[_-]?charge$/;
const FOC_NAME_RE = /^\s*f\.?\s?o\.?\s?c\.?\s*$|free\s*of\s*charge/i;

export function isFocPaymentMethod(
  code?: string | null,
  name?: string | null
): boolean {
  const normalizedCode = String(code || "").trim().toLowerCase();
  if (normalizedCode && FOC_CODE_RE.test(normalizedCode)) return true;
  return Boolean(name && FOC_NAME_RE.test(String(name)));
}
