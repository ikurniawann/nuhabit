/**
 * Logika tampilan loyalty mobile (EPIC-044 Fase B).
 *
 * PORT 1:1 dari dashboard — `src/lib/pos/loyalty-settings.ts` (konversi ARK)
 * dan adapter `src/features/member-portal/nox/use-nox-member.ts` (tipe
 * kredit, unit order). JANGAN mengubah semantik tanpa menyamakan sisi
 * dashboard: saldo simpanan tetap Rupiah, konversi di sini hanya untuk
 * TAMPILAN.
 */

/** Rate fallback sama dengan DEFAULT_POS_LOYALTY_SETTINGS.ark_rate. */
export const DEFAULT_ARK_RATE = 1000;

/** Konversi IDR ke satuan ARK mentah (pecahan boleh). */
export function idrToArk(amountIdr: number, arkRate: number): number {
  const rate = Math.max(1, arkRate || DEFAULT_ARK_RATE);
  return (Number(amountIdr) || 0) / rate;
}

/**
 * ARK bulat untuk TAMPILAN saja — pecahan ≥ 0,5 dibulatkan ke atas, sisanya
 * ke bawah; nilai mutlak dipakai agar transaksi negatif ikut membesar
 * magnitudonya (−Rp 2.500 → −3 ARK), bukan bergeser ke nol.
 */
export function idrToArkDisplay(amountIdr: number, arkRate: number): number {
  const ark = idrToArk(amountIdr, arkRate);
  return Math.sign(ark) * Math.round(Math.abs(ark));
}

/** Tipe transaksi wallet yang MENAMBAH saldo. */
export const CREDIT_TXN_TYPES = new Set(["topup", "topup_bonus", "refund", "bonus"]);

/**
 * Arah transaksi ditentukan TIPE, bukan tanda angka tersimpan — DB memakai
 * nilai positif untuk payment pun (paritas isCreditEntry di src/lib/wallet/ledger.ts: kredit "+", debit "−").
 */
export function isCreditTxn(type: string): boolean {
  return CREDIT_TXN_TYPES.has(type);
}

/** Nilai bertanda untuk tampilan: kredit positif, debit negatif (abs dijamin). */
export function txnSignedArk(view: WalletTxnView): number {
  return isCreditTxn(view.type)
    ? Math.abs(view.arkAmount)
    : -Math.abs(view.arkAmount);
}

/** Label transaksi selaras portal Nox. */
const TXN_LABELS: Record<string, string> = {
  topup: "Top-up",
  topup_bonus: "Bonus top-up",
  payment: "Pembayaran",
  refund: "Refund",
};

export function txnLabel(type: string): string {
  return TXN_LABELS[type] ?? type;
}

/* ---------- model tampilan ---------- */

export interface WalletTxnView {
  id: string;
  type: string;
  /** Sudah dalam ARK display (bulat) bertanda. */
  arkAmount: number;
  createdAt: string;
  notes: string | null;
}

export interface OrderTxnView {
  id: string;
  orderNumber: string;
  totalIdr: number;
  /** Order ARK tampil berdampingan "Rp … / … ARK" (keputusan owner 2026-08-23). */
  paidWithArk: boolean;
  arkDisplay: number | null;
  createdAt: string;
}

export function mapWalletRow(row: {
  id: string;
  type: string;
  amount: number;
  created_at: string;
  notes: string | null;
}, arkRate: number): WalletTxnView {
  return {
    id: row.id,
    type: row.type,
    arkAmount: idrToArkDisplay(Number(row.amount) || 0, arkRate),
    createdAt: row.created_at,
    notes: row.notes,
  };
}

export function mapOrderRow(row: {
  id: string;
  order_number: string;
  total_amount: number;
  payment_method: string | null;
  created_at: string;
}, arkRate: number): OrderTxnView {
  const totalIdr = Number(row.total_amount) || 0;
  const paidWithArk = row.payment_method === "ark_coin";
  return {
    id: row.id,
    orderNumber: row.order_number,
    totalIdr,
    paidWithArk,
    arkDisplay: paidWithArk ? idrToArkDisplay(totalIdr, arkRate) : null,
    createdAt: row.created_at,
  };
}

/* ---------- formatter ---------- */

export function angka(value: number): string {
  return value.toLocaleString("id-ID");
}

export function formatIdr(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function tanggal(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });
}

/* ---------- progres tier ---------- */

export interface TierRow {
  code: string;
  name: string;
  min_lifetime_xp: number;
}

/**
 * Persen progres XP di ANTARA tier saat ini dan berikutnya (bukan dari 0
 * platform) — bar terasa jujur bagi member Bronze menuju Silver.
 * Bila data tak lengkap atau sudah tier tertinggi → null.
 */
export function tierProgressPercent(
  totalXp: number,
  tiers: TierRow[],
  currentCode: string | undefined,
  hasNextTier: boolean
): number | null {
  if (!hasNextTier || !currentCode) return null;
  const sorted = [...tiers].sort((a, b) => a.min_lifetime_xp - b.min_lifetime_xp);
  const idx = sorted.findIndex((t) => t.code === currentCode);
  if (idx === -1 || idx === sorted.length - 1) return null;
  const curMin = sorted[idx].min_lifetime_xp;
  const nextMin = sorted[idx + 1].min_lifetime_xp;
  const span = nextMin - curMin;
  if (span <= 0) return null;
  const pct = Math.floor(((totalXp - curMin) / span) * 100);
  return Math.min(100, Math.max(0, pct));
}
