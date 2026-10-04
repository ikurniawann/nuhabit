/**
 * Aturan kredit kelas gym (pure, tanpa DB). Port ledger.ts NüHabit.
 *
 * - Saldo selalu diturunkan dari buku besar: SUM(amount), tidak pernah disimpan.
 * - Lot = satu batch kredit + tanggal kedaluwarsa. Kredit masuk lot lewat
 *   top_up, bonus, atau penyesuaian plus.
 * - Pemakaian (class_deduction, penyesuaian minus) adalah kolam bersama yang
 *   dialokasikan FIFO ke lot yang paling cepat kedaluwarsa. Refund kelas dan
 *   reversal plus mengembalikan kolam itu.
 * - Entri negatif yang menunjuk lot (expiration, reversal top-up) memotong
 *   lot itu langsung, bukan kolam.
 */

export const CREDIT_ENTRY_TYPES = [
  "top_up",
  "class_deduction",
  "refund",
  "bonus",
  "expiration",
  "adjustment",
  "reversal",
] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

export interface CreditEntry {
  id: string;
  type: CreditEntryType;
  /** Kredit bertanda. */
  amount: number;
  lotId: string | null;
  reversesEntryId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  createdAt: Date;
}

export interface CreditLot {
  id: string;
  packageId: string | null;
  credits: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface LotRemainder {
  lot: CreditLot;
  remaining: number;
}

const DAY_MS = 86_400_000;

export const computeCreditBalance = (entries: readonly Pick<CreditEntry, "amount">[]): number =>
  entries.reduce((sum, e) => sum + e.amount, 0);

/** Tanggal kedaluwarsa lot: `from` + N hari. */
export const lotExpiry = (from: Date, validityDays: number): Date => new Date(from.getTime() + validityDays * DAY_MS);

/** Entri negatif yang dipotong langsung dari lot tertentu (bukan kolam FIFO). */
const isPinnedDebit = (e: CreditEntry) => e.amount < 0 && e.lotId !== null && (e.type === "expiration" || e.type === "reversal");

/** Entri positif yang membuat lotnya sendiri (tidak mengembalikan kolam). */
const createsLot = (e: CreditEntry) => e.amount > 0 && e.lotId !== null;

/**
 * Sisa kredit tiap lot, urut kedaluwarsa paling awal. Pemakaian kolam
 * dialokasikan FIFO; potongan yang menunjuk lot (expiration/reversal)
 * dikurangi lebih dulu dari lotnya.
 */
export function computeLotRemainders(lots: readonly CreditLot[], entries: readonly CreditEntry[]): LotRemainder[] {
  const sorted = [...lots].sort(
    (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
  );

  const pinned = new Map<string, number>();
  let consumed = 0;
  for (const e of entries) {
    if (isPinnedDebit(e)) pinned.set(e.lotId!, (pinned.get(e.lotId!) ?? 0) - e.amount);
    else if (e.amount < 0) consumed -= e.amount;
    else if (!createsLot(e)) consumed -= e.amount;
  }
  consumed = Math.max(0, consumed);

  return sorted.map((lot) => {
    const available = Math.max(0, lot.credits - (pinned.get(lot.id) ?? 0));
    const take = Math.min(available, consumed);
    consumed -= take;
    return { lot, remaining: available - take };
  });
}

export interface ExpirationDraft {
  type: "expiration";
  amount: number;
  lotId: string;
  /** Kunci idempoten: dua pembacaan bersamaan tidak menulis kedaluwarsa ganda. */
  idempotencyKey: string;
  note: string;
}

/** Entri expiration untuk lot yang sudah lewat masa berlakunya dan masih bersisa. */
export function deriveExpirationEntries(
  lots: readonly CreditLot[],
  entries: readonly CreditEntry[],
  now: Date
): ExpirationDraft[] {
  const priorExpirations = new Map<string, number>();
  for (const e of entries) {
    if (e.type === "expiration" && e.lotId) priorExpirations.set(e.lotId, (priorExpirations.get(e.lotId) ?? 0) + 1);
  }
  return computeLotRemainders(lots, entries)
    .filter(({ lot, remaining }) => remaining > 0 && lot.expiresAt.getTime() <= now.getTime())
    .map(({ lot, remaining }) => ({
      type: "expiration" as const,
      amount: -remaining,
      lotId: lot.id,
      idempotencyKey: `gym-expire:${lot.id}:${priorExpirations.get(lot.id) ?? 0}`,
      note: `${remaining} kredit kedaluwarsa`,
    }));
}

/** Lot yang masih bersisa dan akan kedaluwarsa dalam `withinDays` hari. */
export function expiringLots(
  lots: readonly CreditLot[],
  entries: readonly CreditEntry[],
  now: Date,
  withinDays: number
): LotRemainder[] {
  const horizon = now.getTime() + withinDays * DAY_MS;
  return computeLotRemainders(lots, entries).filter(
    ({ lot, remaining }) => remaining > 0 && lot.expiresAt.getTime() > now.getTime() && lot.expiresAt.getTime() <= horizon
  );
}

/**
 * Jenis kelas yang boleh dibooking dengan kredit hidup member; null = bebas.
 * Lot tanpa paket (bonus/penyesuaian) atau paket tanpa batasan mencabut batasan.
 */
export function coveredClassTypeIds(
  remainders: readonly LotRemainder[],
  packageCoverage: ReadonlyMap<string, readonly string[] | null>,
  now: Date
): string[] | null {
  const covered = new Set<string>();
  for (const { lot, remaining } of remainders) {
    if (remaining <= 0 || lot.expiresAt.getTime() <= now.getTime()) continue;
    const coverage = lot.packageId ? packageCoverage.get(lot.packageId) : null;
    if (!coverage) return null;
    coverage.forEach((id) => covered.add(id));
  }
  return covered.size === 0 ? null : [...covered];
}

export const isClassTypeCovered = (covered: readonly string[] | null, classTypeId: string) =>
  covered === null || covered.includes(classTypeId);

/* ── Reversal ────────────────────────────────────────────────────────── */

export type ReversalProblem = "cannot_reverse_reversal" | "cannot_reverse_expiration" | "already_reversed" | "insufficient_balance";

export const REVERSAL_PROBLEM_MESSAGES: Record<ReversalProblem, string> = {
  cannot_reverse_reversal: "Entri pembatalan tidak bisa dibatalkan lagi.",
  cannot_reverse_expiration: "Kredit yang sudah kedaluwarsa tidak bisa dikembalikan lewat pembatalan. Pakai penyesuaian.",
  already_reversed: "Entri ini sudah pernah dibatalkan.",
  insufficient_balance: "Saldo kredit member tidak cukup untuk membatalkan entri ini.",
};

export interface ReversalDraft {
  type: "reversal";
  amount: number;
  /** Reversal entri yang membuat lot memotong lot itu langsung. */
  lotId: string | null;
  reversesEntryId: string;
  sourceType: string | null;
  sourceId: string | null;
  note: string;
}

export function buildReversalEntry(
  original: CreditEntry,
  args: { reason: string; alreadyReversed: boolean; balance: number }
): { ok: true; draft: ReversalDraft } | { ok: false; problem: ReversalProblem } {
  if (original.type === "reversal") return { ok: false, problem: "cannot_reverse_reversal" };
  if (original.type === "expiration") return { ok: false, problem: "cannot_reverse_expiration" };
  if (args.alreadyReversed) return { ok: false, problem: "already_reversed" };
  const amount = -original.amount;
  if (args.balance + amount < 0) return { ok: false, problem: "insufficient_balance" };
  return {
    ok: true,
    draft: {
      type: "reversal",
      amount,
      lotId: createsLot(original) ? original.lotId : null,
      reversesEntryId: original.id,
      sourceType: original.sourceType ?? null,
      sourceId: original.sourceId ?? null,
      note: args.reason.trim(),
    },
  };
}

/* ── Penyesuaian manual ──────────────────────────────────────────────── */

export const MIN_REASON_LENGTH = 3;

export function validateAdjustment(input: { amount: number; reason: string; balance: number }): string | null {
  if (!Number.isInteger(input.amount) || input.amount === 0) return "Jumlah penyesuaian harus bilangan bulat dan tidak nol.";
  if (Math.abs(input.amount) > 1000) return "Jumlah penyesuaian maksimal 1.000 kredit.";
  if (input.reason.trim().length < MIN_REASON_LENGTH) return "Alasan penyesuaian wajib diisi.";
  if (input.balance + input.amount < 0) return "Saldo kredit tidak boleh minus.";
  return null;
}

/* ── Kelayakan beli paket ────────────────────────────────────────────── */

export interface PurchasablePackage {
  id: string;
  status: "active" | "archived";
  purchaseLimitPerMember: number | null;
  branchId: string | null;
}

export type PurchaseProblem = "archived" | "limit_reached" | "branch_mismatch" | "member_inactive";

export const PURCHASE_PROBLEM_MESSAGES: Record<PurchaseProblem, string> = {
  archived: "Paket ini sudah tidak dijual.",
  limit_reached: "Batas pembelian paket ini per member sudah tercapai.",
  branch_mismatch: "Paket ini tidak dijual di cabang ini.",
  member_inactive: "Keanggotaan tidak aktif, tidak bisa membeli kredit.",
};

/**
 * `purchaseCount` = pembelian member atas paket ini yang sudah lunas atau
 * masih menunggu pembayaran. `branchId` null = kanal tanpa cabang (portal).
 */
export function checkPackagePurchase(input: {
  pkg: PurchasablePackage;
  purchaseCount: number;
  memberActive: boolean;
  branchId?: string | null;
}): PurchaseProblem | null {
  if (!input.memberActive) return "member_inactive";
  if (input.pkg.status !== "active") return "archived";
  if (input.pkg.branchId && input.branchId && input.pkg.branchId !== input.branchId) return "branch_mismatch";
  if (input.pkg.purchaseLimitPerMember !== null && input.purchaseCount >= input.pkg.purchaseLimitPerMember) {
    return "limit_reached";
  }
  return null;
}

/** Diskon tidak boleh melebihi harga; total = harga − diskon. */
export function purchaseTotal(priceIdr: number, discountIdr = 0): { discountIdr: number; totalIdr: number } {
  const discount = Math.min(Math.max(0, Math.round(discountIdr)), priceIdr);
  return { discountIdr: discount, totalIdr: priceIdr - discount };
}
