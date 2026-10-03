/**
 * Akses DB kredit kelas gym. Semua fungsi menerima client dari pemanggil
 * supaya bisa digabung dalam satu transaksi (mis. booking + potong kredit).
 *
 * Panggil di dalam withTransaction: advisory lock per member hanya bertahan
 * sampai akhir transaksi, dan itulah yang menjaga dua potongan bersamaan
 * tidak sama-sama lolos cek saldo.
 */
import type { Pool, PoolClient } from "pg";
import {
  buildReversalEntry,
  computeCreditBalance,
  computeLotRemainders,
  coveredClassTypeIds,
  deriveExpirationEntries,
  expiringLots,
  REVERSAL_PROBLEM_MESSAGES,
  validateAdjustment,
  lotExpiry,
  type CreditEntry,
  type CreditEntryType,
  type CreditLot,
} from "./credits";
import { getGymRules } from "./rules";

export type Db = Pool | PoolClient;

export class GymCreditError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Serialkan mutasi kredit satu member sampai transaksi selesai. */
export async function lockMemberCredits(client: Db, customerId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('gym-credits:' || $1::text))`, [customerId]);
}

interface LedgerState {
  lots: CreditLot[];
  entries: CreditEntry[];
}

async function loadLedgerState(client: Db, customerId: string): Promise<LedgerState> {
  const [lots, entries] = await Promise.all([
    client.query(
      `SELECT id, package_id, credits, expires_at, created_at FROM gym.credit_lots WHERE customer_id = $1`,
      [customerId]
    ),
    client.query(
      `SELECT id, type, amount, lot_id, reverses_entry_id, source_type, source_id, created_at
         FROM gym.credit_ledger WHERE customer_id = $1 ORDER BY created_at, id`,
      [customerId]
    ),
  ]);
  return {
    lots: lots.rows.map((r) => ({
      id: r.id,
      packageId: r.package_id,
      credits: Number(r.credits),
      expiresAt: new Date(r.expires_at),
      createdAt: new Date(r.created_at),
    })),
    entries: entries.rows.map((r) => ({
      id: r.id,
      type: r.type as CreditEntryType,
      amount: Number(r.amount),
      lotId: r.lot_id,
      reversesEntryId: r.reverses_entry_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      createdAt: new Date(r.created_at),
    })),
  };
}

interface NewEntry {
  customerId: string;
  type: CreditEntryType;
  amount: number;
  lotId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  reversesEntryId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  createdBy?: string | null;
}

/** Tulis satu entri; null bila idempotency_key sudah ada (permintaan ulang). */
async function insertEntry(client: Db, e: NewEntry): Promise<{ id: string } | null> {
  const { rows } = await client.query(
    `INSERT INTO gym.credit_ledger
       (customer_id, type, amount, lot_id, source_type, source_id, reverses_entry_id, note, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      e.customerId,
      e.type,
      e.amount,
      e.lotId ?? null,
      e.sourceType ?? null,
      e.sourceId ?? null,
      e.reversesEntryId ?? null,
      e.note ?? null,
      e.idempotencyKey ?? null,
      e.createdBy ?? null,
    ]
  );
  return rows[0] ?? null;
}

/** Tulis entri expiration untuk lot yang lewat masa berlaku, lalu kembalikan state terbaru. */
async function expireLapsedLots(client: Db, customerId: string, now = new Date()): Promise<LedgerState> {
  const state = await loadLedgerState(client, customerId);
  const drafts = deriveExpirationEntries(state.lots, state.entries, now);
  if (drafts.length === 0) return state;
  for (const d of drafts) {
    await insertEntry(client, {
      customerId,
      type: d.type,
      amount: d.amount,
      lotId: d.lotId,
      sourceType: "system",
      note: d.note,
      idempotencyKey: d.idempotencyKey,
    });
  }
  return loadLedgerState(client, customerId);
}

/** Saldo kredit (SUM buku besar) setelah kredit kedaluwarsa dicatat. */
export async function getCreditBalance(client: Db, customerId: string): Promise<number> {
  const { entries } = await expireLapsedLots(client, customerId);
  return computeCreditBalance(entries);
}

export async function deductCredits(
  client: Db,
  input: { customerId: string; amount: number; sourceType: string; sourceId: string; idempotencyKey: string; note?: string }
): Promise<{ ok: true; balanceAfter: number } | { ok: false; reason: "insufficient" }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new GymCreditError("Potongan kredit harus bilangan bulat positif");
  await lockMemberCredits(client, input.customerId);
  const { entries } = await expireLapsedLots(client, input.customerId);
  const balance = computeCreditBalance(entries);
  const { rowCount } = await client.query(`SELECT 1 FROM gym.credit_ledger WHERE idempotency_key = $1`, [input.idempotencyKey]);
  if (rowCount) return { ok: true, balanceAfter: balance };
  if (balance < input.amount) return { ok: false, reason: "insufficient" };
  await insertEntry(client, {
    customerId: input.customerId,
    type: "class_deduction",
    amount: -input.amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    note: input.note ?? null,
    idempotencyKey: input.idempotencyKey,
  });
  return { ok: true, balanceAfter: balance - input.amount };
}

export async function refundCredits(
  client: Db,
  input: { customerId: string; amount: number; sourceType: string; sourceId: string; idempotencyKey: string; note?: string }
): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new GymCreditError("Refund kredit harus bilangan bulat positif");
  await lockMemberCredits(client, input.customerId);
  await insertEntry(client, {
    customerId: input.customerId,
    type: "refund",
    amount: input.amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    note: input.note ?? null,
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * Kredit baru beserta lotnya (top_up pembelian, bonus, penyesuaian plus).
 * Idempoten lewat idempotencyKey: permintaan ulang mengembalikan null.
 */
export async function grantCredits(
  client: Db,
  input: {
    customerId: string;
    type: "top_up" | "bonus" | "adjustment";
    credits: number;
    expiresAt: Date;
    packageId?: string | null;
    purchaseId?: string | null;
    sourceType: string;
    sourceId?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
    createdBy?: string | null;
  }
): Promise<{ entryId: string; lotId: string } | null> {
  await lockMemberCredits(client, input.customerId);
  if (input.idempotencyKey) {
    const { rowCount } = await client.query(`SELECT 1 FROM gym.credit_ledger WHERE idempotency_key = $1`, [input.idempotencyKey]);
    if (rowCount) return null;
  }
  const { rows } = await client.query(
    `INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.customerId, input.packageId ?? null, input.purchaseId ?? null, input.credits, input.expiresAt]
  );
  const lotId = rows[0].id as string;
  const entry = await insertEntry(client, {
    customerId: input.customerId,
    type: input.type,
    amount: input.credits,
    lotId,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    note: input.note ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    createdBy: input.createdBy ?? null,
  });
  if (!entry) throw new GymCreditError("Kredit sudah tercatat", 409);
  return { entryId: entry.id, lotId };
}

/** Penyesuaian manual staf. Plus = lot baru dengan masa berlaku default aturan gym. */
export async function adjustCredits(
  client: Db,
  input: { customerId: string; amount: number; reason: string; actorId: string }
): Promise<{ entryId: string; balanceAfter: number }> {
  await lockMemberCredits(client, input.customerId);
  const balance = await getCreditBalance(client, input.customerId);
  const problem = validateAdjustment({ amount: input.amount, reason: input.reason, balance });
  if (problem) throw new GymCreditError(problem);
  const note = input.reason.trim();
  if (input.amount > 0) {
    const rules = await getGymRules(client);
    const granted = await grantCredits(client, {
      customerId: input.customerId,
      type: "adjustment",
      credits: input.amount,
      expiresAt: lotExpiry(new Date(), rules.creditExpiryDays),
      sourceType: "admin",
      note,
      createdBy: input.actorId,
    });
    return { entryId: granted!.entryId, balanceAfter: balance + input.amount };
  }
  const entry = await insertEntry(client, {
    customerId: input.customerId,
    type: "adjustment",
    amount: input.amount,
    sourceType: "admin",
    note,
    createdBy: input.actorId,
  });
  return { entryId: entry!.id, balanceAfter: balance + input.amount };
}

/** Entri pembalik untuk satu entri buku besar (koreksi kesalahan, refund pembelian). */
export async function reverseCreditEntry(
  client: Db,
  input: { entryId: string; reason: string; actorId: string | null }
): Promise<{ entryId: string; customerId: string; amount: number }> {
  if (input.reason.trim().length < 3) throw new GymCreditError("Alasan pembatalan wajib diisi");
  const { rows } = await client.query(
    `SELECT id, customer_id, type, amount, lot_id, source_type, source_id, created_at
       FROM gym.credit_ledger WHERE id = $1`,
    [input.entryId]
  );
  const row = rows[0];
  if (!row) throw new GymCreditError("Entri kredit tidak ditemukan", 404);
  await lockMemberCredits(client, row.customer_id);
  const { rowCount } = await client.query(`SELECT 1 FROM gym.credit_ledger WHERE reverses_entry_id = $1`, [row.id]);
  const balance = await getCreditBalance(client, row.customer_id);
  const result = buildReversalEntry(
    {
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      lotId: row.lot_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdAt: new Date(row.created_at),
    },
    { reason: input.reason, alreadyReversed: Boolean(rowCount), balance }
  );
  if (!result.ok) throw new GymCreditError(REVERSAL_PROBLEM_MESSAGES[result.problem], 409);
  const entry = await insertEntry(client, {
    customerId: row.customer_id,
    ...result.draft,
    createdBy: input.actorId,
  });
  return { entryId: entry!.id, customerId: row.customer_id, amount: result.draft.amount };
}

/** Jenis kelas yang boleh dibooking kredit member saat ini; null = semua kelas. */
export async function getCoveredClassTypeIds(client: Db, customerId: string): Promise<string[] | null> {
  const state = await expireLapsedLots(client, customerId);
  const { rows } = await client.query(`SELECT id, applicable_class_type_ids FROM gym.credit_packages`);
  const coverage = new Map<string, string[] | null>(rows.map((r) => [r.id, r.applicable_class_type_ids]));
  return coveredClassTypeIds(computeLotRemainders(state.lots, state.entries), coverage, new Date());
}

/* ── Tampilan dompet kredit (admin & portal) ─────────────────────────── */

export interface CreditLotView {
  id: string;
  package_id: string | null;
  package_name: string | null;
  credits: number;
  remaining: number;
  expires_at: string;
  created_at: string;
  expired: boolean;
}

export interface CreditEntryView {
  id: string;
  type: CreditEntryType;
  amount: number;
  lot_id: string | null;
  source_type: string | null;
  source_id: string | null;
  reverses_entry_id: string | null;
  reversed: boolean;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CreditWalletView {
  balance: number;
  expiring_credits: number;
  expiry_reminder_days: number;
  low_balance: boolean;
  low_balance_threshold: number;
  lots: CreditLotView[];
  expiring_lots: CreditLotView[];
  entries: CreditEntryView[];
}

/** Saldo, lot, kredit yang segera kedaluwarsa, dan riwayat terbaru (menulis kedaluwarsa tertunda). */
export async function loadCreditWallet(client: Db, customerId: string, entryLimit = 100): Promise<CreditWalletView> {
  const now = new Date();
  const state = await expireLapsedLots(client, customerId, now);
  const rules = await getGymRules(client);
  const [packages, recent] = await Promise.all([
    client.query(`SELECT id, name FROM gym.credit_packages`),
    client.query(
      `SELECT l.id, l.type, l.amount, l.lot_id, l.source_type, l.source_id, l.reverses_entry_id, l.note, l.created_at,
              u.full_name AS created_by_name,
              EXISTS (SELECT 1 FROM gym.credit_ledger r WHERE r.reverses_entry_id = l.id) AS reversed
         FROM gym.credit_ledger l
         LEFT JOIN configuration.users u ON u.id = l.created_by
        WHERE l.customer_id = $1
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $2`,
      [customerId, entryLimit]
    ),
  ]);
  const names = new Map<string, string>(packages.rows.map((r) => [r.id, r.name]));
  const toView = ({ lot, remaining }: { lot: CreditLot; remaining: number }): CreditLotView => ({
    id: lot.id,
    package_id: lot.packageId,
    package_name: lot.packageId ? (names.get(lot.packageId) ?? null) : null,
    credits: lot.credits,
    remaining,
    expires_at: lot.expiresAt.toISOString(),
    created_at: lot.createdAt.toISOString(),
    expired: lot.expiresAt.getTime() <= now.getTime(),
  });
  const balance = computeCreditBalance(state.entries);
  const expiring = expiringLots(state.lots, state.entries, now, rules.expiryReminderDays);
  return {
    balance,
    expiring_credits: expiring.reduce((s, r) => s + r.remaining, 0),
    expiry_reminder_days: rules.expiryReminderDays,
    low_balance: balance <= rules.lowBalanceThreshold,
    low_balance_threshold: rules.lowBalanceThreshold,
    lots: computeLotRemainders(state.lots, state.entries).map(toView),
    expiring_lots: expiring.map(toView),
    entries: recent.rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      lot_id: r.lot_id,
      source_type: r.source_type,
      source_id: r.source_id,
      reverses_entry_id: r.reverses_entry_id,
      reversed: r.reversed,
      note: r.note,
      created_by_name: r.created_by_name,
      created_at: new Date(r.created_at).toISOString(),
    })),
  };
}
