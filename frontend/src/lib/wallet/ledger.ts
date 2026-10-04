/**
 * Aturan buku besar dompet ARK Coin (pure, tanpa DB).
 *
 * Baris pos.pos_wallet_transactions tidak konsisten soal tanda `amount`:
 * RPC update_ark_coin_balance menyimpan ABS(amount), baris lain bertanda.
 * Arah mutasi karena itu ditentukan dari tipe, lalu dari selisih saldo.
 *
 * Lot = satu kredit (topup, bonus, refund, penyesuaian plus) dengan masa
 * berlaku sendiri. Pemakaian dialokasikan FIFO ke lot yang paling cepat
 * kedaluwarsa (port ComputeLotRemainders NüHabit).
 */

/** Selalu menambah saldo. */
const CREDIT_TYPES = new Set(["topup", "topup_bonus", "bonus", "refund"]);
/** Selalu mengurangi saldo. */
const DEBIT_TYPES = new Set(["payment", "withdrawal", "redeem", "expiration", "topup_refund"]);
/** Arah tergantung tanda (koreksi admin). */
const SIGNED_TYPES = new Set(["adjustment", "reversal"]);
/** Tipe yang kreditnya menjadi lot berkedaluwarsa. */
export const LOT_TYPES = new Set(["topup", "topup_bonus", "bonus", "refund", "adjustment"]);

export const LOW_BALANCE_NUDGE_COOLDOWN_DAYS = 7;
const DAY_MS = 86_400_000;

export interface LedgerRow {
  id: string;
  type: string;
  status?: string | null;
  amount: number | string;
  balance_before?: number | string | null;
  balance_after?: number | string | null;
  created_at: string | Date;
  expires_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface LotAllocation {
  lot_id: string;
  amount: number;
}

interface Lot {
  id: string;
  type: string;
  amount: number;
  createdAt: Date;
  expiresAt: Date | null;
}

interface LotRemainder {
  lot: Lot;
  /** Saldo lot yang belum terpakai/kedaluwarsa/dibatalkan. */
  remaining: number;
}

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toDate = (value: string | Date | null | undefined): Date | null =>
  value == null ? null : value instanceof Date ? value : new Date(value);

/** Pembulatan rupiah ke 2 desimal (kolom numeric(12,2)). */
export const roundIdr = (value: number) => Math.round(value * 100) / 100;

export function isCompleted(row: Pick<LedgerRow, "status">): boolean {
  return (row.status ?? "completed") === "completed";
}

/** Mutasi bertanda: positif menambah saldo, negatif mengurangi. */
export function signedDelta(row: LedgerRow): number {
  const amount = Math.abs(num(row.amount));
  if (CREDIT_TYPES.has(row.type)) return amount;
  if (DEBIT_TYPES.has(row.type)) return -amount;
  const diff = num(row.balance_after) - num(row.balance_before);
  return diff !== 0 ? roundIdr(diff) : num(row.amount);
}

/** Untuk tampilan: apakah baris ini menambah saldo member. */
export function isCreditEntry(type: string, amount: number): boolean {
  if (CREDIT_TYPES.has(type)) return true;
  if (SIGNED_TYPES.has(type)) return amount > 0;
  return false;
}

export function isLotRow(row: LedgerRow): boolean {
  return isCompleted(row) && LOT_TYPES.has(row.type) && signedDelta(row) > 0;
}

function readAllocations(metadata: LedgerRow["metadata"]): LotAllocation[] {
  const raw = metadata?.lot_allocations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return { lot_id: String(entry.lot_id ?? ""), amount: num(entry.amount) };
    })
    .filter((a) => a.lot_id && a.amount > 0);
}

/** Lot paling cepat kedaluwarsa dulu; tanpa kedaluwarsa paling akhir. */
function compareLots(a: Lot, b: Lot): number {
  const ea = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const eb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ea !== eb) return ea < eb ? -1 : 1;
  const ca = a.createdAt.getTime();
  const cb = b.createdAt.getTime();
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sisa setiap lot setelah pemakaian. Debit yang membawa
 * `metadata.lot_allocations` (kedaluwarsa, pembatalan kredit, refund top-up)
 * dipatok ke lot tertentu; kelebihannya, dan debit lain, menjadi pemakaian
 * umum yang dialokasikan FIFO. Kredit non-lot (pembatalan debit) mengembalikan
 * pemakaian umum.
 */
export function computeLotRemainders(rows: LedgerRow[]): LotRemainder[] {
  const lots: Lot[] = [];
  const pinned = new Map<string, number>();
  let pool = 0;

  for (const row of rows) {
    if (!isCompleted(row)) continue;
    if (isLotRow(row)) {
      lots.push({
        id: row.id,
        type: row.type,
        amount: signedDelta(row),
        createdAt: toDate(row.created_at) ?? new Date(0),
        expiresAt: toDate(row.expires_at),
      });
      continue;
    }
    const delta = signedDelta(row);
    if (delta >= 0) {
      pool -= delta;
      continue;
    }
    let left = -delta;
    for (const a of readAllocations(row.metadata)) {
      const take = Math.min(a.amount, left);
      pinned.set(a.lot_id, (pinned.get(a.lot_id) ?? 0) + take);
      left -= take;
    }
    pool += left;
  }

  const lotIds = new Set(lots.map((l) => l.id));
  for (const [lotId, amount] of pinned) {
    if (!lotIds.has(lotId)) pool += amount;
  }

  lots.sort(compareLots);
  const afterPinned = lots.map((lot) => {
    const rest = lot.amount - (pinned.get(lot.id) ?? 0);
    if (rest < 0) pool += -rest;
    return Math.max(0, rest);
  });

  pool = Math.max(0, pool);
  return lots.map((lot, i) => {
    const take = Math.min(afterPinned[i], pool);
    pool -= take;
    return { lot, remaining: roundIdr(afterPinned[i] - take) };
  });
}

interface ExpirationDraft {
  lot_id: string;
  /** Rupiah yang hangus (positif). */
  amount: number;
  balance_before: number;
  balance_after: number;
}

/**
 * Rencana sapuan kedaluwarsa satu member. Sisa lot yang lewat masa berlaku
 * dihanguskan, tidak pernah melebihi saldo tersimpan (saldo lama bisa tidak
 * cocok dengan riwayat). `processedLotIds` = semua lot jatuh tempo yang belum
 * diproses, termasuk yang sisanya 0, supaya tidak dicek ulang tiap jam.
 */
export function planExpirySweep(input: {
  rows: LedgerRow[];
  balance: number;
  now: Date;
  /** Lot yang sudah punya baris expiration (penjaga idempoten). */
  alreadyExpiredLotIds?: ReadonlySet<string>;
}): { entries: ExpirationDraft[]; processedLotIds: string[] } {
  const done = input.alreadyExpiredLotIds ?? new Set<string>();
  const entries: ExpirationDraft[] = [];
  const processedLotIds: string[] = [];
  let balance = Math.max(0, input.balance);

  for (const { lot, remaining } of computeLotRemainders(input.rows)) {
    if (!lot.expiresAt || lot.expiresAt.getTime() > input.now.getTime()) continue;
    processedLotIds.push(lot.id);
    if (done.has(lot.id)) continue;
    const amount = roundIdr(Math.min(remaining, balance));
    if (amount <= 0) continue;
    entries.push({ lot_id: lot.id, amount, balance_before: balance, balance_after: roundIdr(balance - amount) });
    balance = roundIdr(balance - amount);
  }
  return { entries, processedLotIds };
}

interface ExpiringLot {
  lot_id: string;
  remaining: number;
  expires_at: Date;
}

/** Lot yang perlu diingatkan: kedaluwarsa dalam `withinDays` hari, masih bersisa, belum diingatkan. */
export function selectExpiryReminders(input: {
  rows: LedgerRow[];
  now: Date;
  withinDays: number;
  remindedLotIds: ReadonlySet<string>;
}): ExpiringLot[] {
  if (input.withinDays <= 0) return [];
  const nowMs = input.now.getTime();
  const horizon = nowMs + input.withinDays * DAY_MS;
  return computeLotRemainders(input.rows)
    .filter(({ lot, remaining }) => {
      const at = lot.expiresAt?.getTime();
      return at != null && at > nowMs && at <= horizon && remaining > 0 && !input.remindedLotIds.has(lot.id);
    })
    .map(({ lot, remaining }) => ({ lot_id: lot.id, remaining, expires_at: lot.expiresAt as Date }));
}

/**
 * Dorongan saldo rendah: saldo baru saja turun melewati ambang (crossedAt),
 * masih di bawah ambang, dan belum didorong dalam 7 hari terakhir atau sejak
 * penurunan ini.
 */
export function shouldNudgeLowBalance(input: {
  threshold: number;
  balance: number;
  crossedAt: Date | null;
  lastNudgeAt: Date | null;
  now: Date;
}): boolean {
  if (input.threshold <= 0 || input.balance >= input.threshold || !input.crossedAt) return false;
  if (!input.lastNudgeAt) return true;
  const cooledDown = input.now.getTime() - input.lastNudgeAt.getTime() >= LOW_BALANCE_NUDGE_COOLDOWN_DAYS * DAY_MS;
  return cooledDown && input.crossedAt.getTime() > input.lastNudgeAt.getTime();
}

/** Tanggal kedaluwarsa dari masa berlaku (hari); null = tidak kedaluwarsa. */
export function expiresAtFor(validityDays: number | null | undefined, from: Date): Date | null {
  if (validityDays == null || !(validityDays > 0)) return null;
  return new Date(from.getTime() + validityDays * DAY_MS);
}
