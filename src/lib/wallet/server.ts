/**
 * Akses DB dompet member: pengaturan, buku besar, koreksi admin.
 * Semua mutasi saldo berjalan dalam transaksi dengan baris member terkunci.
 */
import type { Pool, PoolClient } from "pg";
import { getPool, withTransaction } from "@/lib/db";
import { POS_LOYALTY_SETTINGS_SINGLETON_ID } from "@/lib/pos/loyalty-settings";
import { validateAdjustment, validateReversal, validateTopupRefund } from "./corrections";
import { computeLotRemainders, expiresAtFor, roundIdr, type LedgerRow } from "./ledger";

type Db = Pool | PoolClient;

export class WalletError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

interface WalletActor {
  id: string;
  name: string;
}

/* ── Pengaturan ──────────────────────────────────────────────────────── */

export interface WalletSettings {
  ark_rate: number;
  topup_min_amount: number;
  topup_max_amount: number;
  low_balance_threshold_idr: number;
  wallet_default_validity_days: number | null;
  wallet_expiry_reminder_days: number;
}

const DEFAULT_SETTINGS: WalletSettings = {
  ark_rate: 1000,
  topup_min_amount: 10_000,
  topup_max_amount: 10_000_000,
  low_balance_threshold_idr: 0,
  wallet_default_validity_days: null,
  wallet_expiry_reminder_days: 7,
};

export async function loadWalletSettings(db: Db = getPool()): Promise<WalletSettings> {
  const { rows } = await db.query(
    `SELECT ark_rate::float AS ark_rate, topup_min_amount::float AS topup_min_amount,
            topup_max_amount::float AS topup_max_amount,
            low_balance_threshold_idr::float AS low_balance_threshold_idr,
            wallet_default_validity_days, wallet_expiry_reminder_days
       FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`
  );
  return rows[0] ? { ...DEFAULT_SETTINGS, ...rows[0] } : { ...DEFAULT_SETTINGS };
}

type WalletSettingsInput = Omit<WalletSettings, "ark_rate" | "topup_min_amount">;

export async function saveWalletSettings(input: WalletSettingsInput, actorId: string): Promise<WalletSettings> {
  const params = [
    input.topup_max_amount,
    input.low_balance_threshold_idr,
    input.wallet_default_validity_days,
    input.wallet_expiry_reminder_days,
    actorId,
  ];
  const updated = await getPool().query(
    `UPDATE pos.pos_loyalty_settings
        SET topup_max_amount = $1, low_balance_threshold_idr = $2, wallet_default_validity_days = $3,
            wallet_expiry_reminder_days = $4, updated_by = $5, updated_at = now()
      WHERE is_active`,
    params
  );
  if (updated.rowCount === 0) {
    await getPool().query(
      `INSERT INTO pos.pos_loyalty_settings
         (id, topup_max_amount, low_balance_threshold_idr, wallet_default_validity_days,
          wallet_expiry_reminder_days, updated_by, is_active)
       VALUES ($6, $1, $2, $3, $4, $5, true)`,
      [...params, POS_LOYALTY_SETTINGS_SINGLETON_ID]
    );
  }
  return loadWalletSettings();
}

/* ── Buku besar ──────────────────────────────────────────────────────── */

export interface WalletRow extends LedgerRow {
  customer_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  ark_coins: number;
  payment_method: string | null;
  xendit_transaction_id: string | null;
  reference_id: string | null;
  order_id: string | null;
  notes: string | null;
  package_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  metadata: Record<string, unknown>;
}

export const WALLET_COLUMNS = `id, customer_id, type, status, amount::float AS amount, ark_coins::float AS ark_coins,
  balance_before::float AS balance_before, balance_after::float AS balance_after, payment_method,
  xendit_transaction_id, reference_id, order_id, notes, metadata, created_at, expires_at, package_id,
  company_id, branch_id`;

export async function loadLedgerRows(db: Db, customerId: string): Promise<WalletRow[]> {
  const { rows } = await db.query(
    `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions WHERE customer_id = $1 ORDER BY created_at, id`,
    [customerId]
  );
  return rows as WalletRow[];
}

interface LockedCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  balance: number;
}

export async function lockCustomer(client: PoolClient, customerId: string): Promise<LockedCustomer> {
  const { rows } = await client.query(
    `SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance
       FROM pos.pos_customers WHERE id = $1 FOR UPDATE`,
    [customerId]
  );
  if (!rows[0]) throw new WalletError("Member tidak ditemukan", 404);
  return rows[0] as LockedCustomer;
}

interface NewWalletRow {
  customer_id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  ark_rate: number;
  notes: string;
  metadata: Record<string, unknown>;
  status?: string;
  payment_method?: string | null;
  reference_id?: string | null;
  xendit_transaction_id?: string | null;
  expires_at?: Date | null;
  package_id?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
}

export async function insertWalletRow(client: Db, row: NewWalletRow): Promise<WalletRow> {
  const { rows } = await client.query(
    `INSERT INTO pos.pos_wallet_transactions
       (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes, metadata,
        payment_method, reference_id, expires_at, package_id, company_id, branch_id, xendit_transaction_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
     RETURNING ${WALLET_COLUMNS}`,
    [
      row.customer_id,
      row.type,
      roundIdr(row.amount),
      roundIdr(row.amount / Math.max(1, row.ark_rate)),
      roundIdr(row.balance_before),
      roundIdr(row.balance_after),
      row.status ?? "completed",
      row.notes,
      JSON.stringify(row.metadata),
      row.payment_method ?? null,
      row.reference_id ?? null,
      row.expires_at ?? null,
      row.package_id ?? null,
      row.company_id ?? null,
      row.branch_id ?? null,
      row.xendit_transaction_id ?? null,
    ]
  );
  return rows[0] as WalletRow;
}

export async function setCustomerBalance(client: PoolClient, customerId: string, balance: number) {
  await client.query(`UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = now() WHERE id = $1`, [
    customerId,
    roundIdr(balance),
  ]);
}

/** Cari member untuk halaman dompet (nama / telepon). */
export async function searchMembers(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const { rows } = await getPool().query(
    `SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance
       FROM pos.pos_customers
      WHERE name ILIKE $1 OR phone ILIKE $1
      ORDER BY name NULLS LAST LIMIT 20`,
    [`%${term}%`]
  );
  return rows as { id: string; name: string | null; phone: string; balance: number }[];
}

/** Ringkasan dompet member untuk halaman admin. */
export async function loadMemberWallet(customerId: string) {
  const pool = getPool();
  const { rows: members } = await pool.query(
    `SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`,
    [customerId]
  );
  if (!members[0]) throw new WalletError("Member tidak ditemukan", 404);
  const rows = await loadLedgerRows(pool, customerId);
  const lots = computeLotRemainders(rows)
    .filter((r) => r.remaining > 0)
    .map(({ lot, remaining }) => ({
      id: lot.id,
      type: lot.type,
      amount: lot.amount,
      remaining,
      created_at: lot.createdAt.toISOString(),
      expires_at: lot.expiresAt?.toISOString() ?? null,
    }));
  return { member: members[0], lots, entries: rows.slice(-200).reverse() };
}

/* ── Koreksi admin ───────────────────────────────────────────────────── */

const audit = (actor: WalletActor, reason: string) => ({
  actor_id: actor.id,
  actor_name: actor.name,
  reason: reason.trim(),
});

export function applyAdjustment(input: { customerId: string; amount: number; reason: string; actor: WalletActor }) {
  return withTransaction(async (client) => {
    const customer = await lockCustomer(client, input.customerId);
    const check = validateAdjustment({ amount: input.amount, reason: input.reason, balance: customer.balance });
    if (!check.ok) throw new WalletError(check.error);
    const settings = await loadWalletSettings(client);
    // Penyesuaian plus menjadi lot baru dengan masa berlaku default.
    const validityDays = check.delta > 0 ? settings.wallet_default_validity_days : null;
    const after = customer.balance + check.delta;
    const row = await insertWalletRow(client, {
      customer_id: customer.id,
      type: "adjustment",
      amount: check.delta,
      balance_before: customer.balance,
      balance_after: after,
      ark_rate: settings.ark_rate,
      notes: `Penyesuaian manual: ${input.reason.trim()}`,
      metadata: { ...audit(input.actor, input.reason), validity_days: validityDays },
      expires_at: expiresAtFor(validityDays, new Date()),
    });
    await setCustomerBalance(client, customer.id, after);
    return row;
  });
}

async function lockEntry(client: PoolClient, entryId: string): Promise<WalletRow> {
  const { rows } = await client.query(
    `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions WHERE id = $1 FOR UPDATE`,
    [entryId]
  );
  if (!rows[0]) throw new WalletError("Entri dompet tidak ditemukan", 404);
  if (!rows[0].customer_id) throw new WalletError("Entri tidak terhubung ke member");
  return rows[0] as WalletRow;
}

async function existsWhere(client: PoolClient, type: string, key: string, id: string) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM pos.pos_wallet_transactions WHERE type = $1 AND metadata->>'${key}' = $2 LIMIT 1`,
    [type, id]
  );
  return (rowCount ?? 0) > 0;
}

async function markEntry(client: PoolClient, entryId: string, patch: Record<string, unknown>) {
  await client.query(
    `UPDATE pos.pos_wallet_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [entryId, JSON.stringify(patch)]
  );
}

export function reverseEntry(input: { entryId: string; reason: string; actor: WalletActor }) {
  return withTransaction(async (client) => {
    const entry = await lockEntry(client, input.entryId);
    const customer = await lockCustomer(client, entry.customer_id);
    const alreadyReversed =
      Boolean(entry.metadata?.reversed_by) || (await existsWhere(client, "reversal", "reverses_id", entry.id));
    const check = validateReversal({ entry, reason: input.reason, balance: customer.balance, alreadyReversed });
    if (!check.ok) throw new WalletError(check.error);
    const settings = await loadWalletSettings(client);
    const after = customer.balance + check.delta;
    const row = await insertWalletRow(client, {
      customer_id: customer.id,
      type: "reversal",
      amount: check.delta,
      balance_before: customer.balance,
      balance_after: after,
      ark_rate: settings.ark_rate,
      notes: `Pembatalan ${entry.type}: ${input.reason.trim()}`,
      metadata: {
        ...audit(input.actor, input.reason),
        reverses_id: entry.id,
        reverses_type: entry.type,
        lot_allocations: check.allocations,
      },
      company_id: entry.company_id,
      branch_id: entry.branch_id,
    });
    await markEntry(client, entry.id, { reversed_by: row.id, reversed_at: new Date().toISOString() });
    await setCustomerBalance(client, customer.id, after);
    return row;
  });
}

export function refundTopup(input: {
  topupId: string;
  method: string;
  reference: string;
  reason: string;
  actor: WalletActor;
}) {
  return withTransaction(async (client) => {
    const topup = await lockEntry(client, input.topupId);
    const customer = await lockCustomer(client, topup.customer_id);
    const { rows: bonusRows } = await client.query(
      `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions
        WHERE type = 'topup_bonus' AND metadata->>'source_topup_id' = $1 FOR UPDATE`,
      [topup.id]
    );
    // Bonus yang sudah dibatalkan terpisah tidak ditarik dua kali.
    const bonus = (bonusRows[0] as WalletRow | undefined) ?? null;
    const liveBonus = bonus && !bonus.metadata?.reversed_by ? bonus : null;
    const check = validateTopupRefund({
      topup,
      bonus: liveBonus,
      balance: customer.balance,
      alreadyRefunded: await existsWhere(client, "topup_refund", "refunds_topup_id", topup.id),
      alreadyReversed: Boolean(topup.metadata?.reversed_by),
      method: input.method,
      reason: input.reason,
    });
    if (!check.ok) throw new WalletError(check.error);
    const settings = await loadWalletSettings(client);
    const after = customer.balance - check.removeIdr;
    const reference = input.reference.trim().slice(0, 100) || null;
    const row = await insertWalletRow(client, {
      customer_id: customer.id,
      type: "topup_refund",
      amount: -check.removeIdr,
      balance_before: customer.balance,
      balance_after: after,
      ark_rate: settings.ark_rate,
      payment_method: input.method,
      reference_id: reference,
      notes: `Refund top-up Rp ${check.refundIdr.toLocaleString("id-ID")} via ${input.method}${
        check.manual ? " (manual, QRIS tanpa refund API)" : ""
      }`,
      metadata: {
        ...audit(input.actor, input.reason),
        refunds_topup_id: topup.id,
        refund_idr: check.refundIdr,
        refund_method: input.method,
        refund_reference: reference,
        original_payment_method: topup.payment_method,
        xendit_transaction_id: topup.xendit_transaction_id,
        manual_refund: check.manual,
        lot_allocations: check.allocations,
      },
      company_id: topup.company_id,
      branch_id: topup.branch_id,
    });
    await markEntry(client, topup.id, { refunded_at: new Date().toISOString(), refund_id: row.id });
    await setCustomerBalance(client, customer.id, after);
    return row;
  });
}
