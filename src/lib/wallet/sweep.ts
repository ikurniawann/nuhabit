/**
 * Sapuan dompet berkala (tiap jam + tombol "Jalankan sekarang"):
 *   1. kedaluwarsa: sisa lot yang lewat masa berlaku dihanguskan (baris
 *      'expiration' + saldo turun dalam satu transaksi, idempoten);
 *   2. pengingat: member dengan lot yang kedaluwarsa dalam N hari, sekali per lot;
 *   3. saldo rendah: dorongan saat saldo turun di bawah ambang, maks. 1×/7 hari.
 * Advisory lock memastikan hanya satu proses yang menyapu pada satu waktu.
 */
import { getPool, withTransaction } from "@/lib/db";
import { notifyMember } from "@/lib/crm/engagement/server";
import { formatWib } from "@/lib/crm/engagement/rules";
import { normalizeWaPhone } from "@/lib/pos/receipt-wa";
import { sendWhatsAppText } from "@/lib/whatsapp";
import {
  LOT_TYPES,
  LOW_BALANCE_NUDGE_COOLDOWN_DAYS,
  planExpirySweep,
  roundIdr,
  selectExpiryReminders,
  shouldNudgeLowBalance,
} from "./ledger";
import { insertWalletRow, loadLedgerRows, loadWalletSettings, lockCustomer, setCustomerBalance, type WalletSettings } from "./server";

const SWEEP_LOCK_KEY = 411_000_401;
const BATCH = 500;
const LOT_TYPE_LIST = [...LOT_TYPES];

interface SweepResult {
  status: "done" | "busy";
  run_id?: string;
  expired_lots: number;
  expired_idr: number;
  reminders_sent: number;
  nudges_sent: number;
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

interface MemberContact {
  name: string | null;
  phone: string | null;
  wa_consent: boolean | null;
}

async function loadContact(customerId: string): Promise<MemberContact | null> {
  const { rows } = await getPool().query(`SELECT name, phone, wa_consent FROM pos.pos_customers WHERE id = $1`, [customerId]);
  return (rows[0] as MemberContact | undefined) ?? null;
}

/** Kirim WA layanan; member yang menolak WA (wa_consent = false) dilewati. */
async function sendMemberWa(contact: MemberContact, message: string): Promise<boolean> {
  const target = contact.wa_consent === false ? null : normalizeWaPhone(contact.phone);
  if (!target) return false;
  try {
    return (await sendWhatsAppText({ target, message }, { messageType: "notification" })).success;
  } catch (error) {
    console.warn("[wallet-sweep] WA gagal:", error instanceof Error ? error.message : error);
    return false;
  }
}

/* ── 1. Kedaluwarsa ──────────────────────────────────────────────────── */

async function expireCustomer(customerId: string, settings: WalletSettings, now: Date, trigger: string) {
  return withTransaction(async (client) => {
    const customer = await lockCustomer(client, customerId);
    const rows = await loadLedgerRows(client, customerId);
    const alreadyExpiredLotIds = new Set(
      rows.filter((r) => r.type === "expiration").map((r) => String(r.metadata?.lot_id ?? ""))
    );
    const plan = planExpirySweep({ rows, balance: customer.balance, now, alreadyExpiredLotIds });
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const draft of plan.entries) {
      const lot = byId.get(draft.lot_id);
      await insertWalletRow(client, {
        customer_id: customerId,
        type: "expiration",
        amount: -draft.amount,
        balance_before: draft.balance_before,
        balance_after: draft.balance_after,
        ark_rate: settings.ark_rate,
        notes: `Saldo kedaluwarsa (${lot?.type ?? "lot"} ${formatWib(lot?.created_at ?? now)})`,
        metadata: {
          lot_id: draft.lot_id,
          lot_type: lot?.type ?? null,
          lot_expires_at: lot?.expires_at ?? null,
          lot_allocations: [{ lot_id: draft.lot_id, amount: draft.amount }],
          swept_by: trigger,
        },
        company_id: lot?.company_id ?? null,
        branch_id: lot?.branch_id ?? null,
      });
    }
    const expiredIdr = roundIdr(plan.entries.reduce((sum, e) => sum + e.amount, 0));
    if (expiredIdr > 0) {
      await setCustomerBalance(client, customerId, plan.entries[plan.entries.length - 1].balance_after);
      await notifyMember(client, customerId, {
        type: "wallet_expired",
        title: "Saldo ARK Coin kedaluwarsa",
        body: `${rupiah(expiredIdr)} saldo Anda melewati masa berlaku dan sudah hangus.`,
      });
    }
    if (plan.processedLotIds.length > 0) {
      await client.query(
        `UPDATE pos.pos_wallet_transactions SET expiry_processed_at = now() WHERE id = ANY($1::uuid[])`,
        [plan.processedLotIds]
      );
    }
    return { lots: plan.entries.length, idr: expiredIdr };
  });
}

async function sweepExpirations(settings: WalletSettings, now: Date, trigger: string) {
  const { rows } = await getPool().query(
    `SELECT DISTINCT customer_id FROM pos.pos_wallet_transactions
      WHERE expires_at <= $1 AND expiry_processed_at IS NULL AND customer_id IS NOT NULL
        AND COALESCE(status, 'completed') = 'completed'
      LIMIT ${BATCH}`,
    [now]
  );
  let lots = 0;
  let idr = 0;
  for (const { customer_id } of rows as { customer_id: string }[]) {
    try {
      const result = await expireCustomer(customer_id, settings, now, trigger);
      lots += result.lots;
      idr += result.idr;
    } catch (error) {
      console.error(`[wallet-sweep] kedaluwarsa member ${customer_id} gagal:`, error);
    }
  }
  return { lots, idr: roundIdr(idr) };
}

/* ── 2. Pengingat kedaluwarsa ────────────────────────────────────────── */

async function remindCustomer(customerId: string, settings: WalletSettings, now: Date): Promise<boolean> {
  const pool = getPool();
  const rows = await loadLedgerRows(pool, customerId);
  const { rows: done } = await pool.query(`SELECT lot_id FROM pos.pos_wallet_lot_reminders WHERE customer_id = $1`, [
    customerId,
  ]);
  const picks = selectExpiryReminders({
    rows,
    now,
    withinDays: settings.wallet_expiry_reminder_days,
    remindedLotIds: new Set(done.map((r) => String(r.lot_id))),
  });
  if (picks.length === 0) return false;

  // Klaim dulu (sekali per lot), baru kirim.
  const claimed: typeof picks = [];
  for (const pick of picks) {
    const { rowCount } = await pool.query(
      `INSERT INTO pos.pos_wallet_lot_reminders (lot_id, customer_id, expires_at, remaining_idr)
       VALUES ($1, $2, $3, $4) ON CONFLICT (lot_id) DO NOTHING`,
      [pick.lot_id, customerId, pick.expires_at, pick.remaining]
    );
    if (rowCount) claimed.push(pick);
  }
  if (claimed.length === 0) return false;

  const total = claimed.reduce((sum, p) => sum + p.remaining, 0);
  const earliest = claimed.reduce((min, p) => (p.expires_at < min ? p.expires_at : min), claimed[0].expires_at);
  const contact = await loadContact(customerId);
  const ark = Math.round(total / Math.max(1, settings.ark_rate));
  await notifyMember(pool, customerId, {
    type: "wallet_expiring",
    title: "Saldo ARK Coin segera kedaluwarsa",
    body: `${rupiah(total)} (${ark} ARK) berakhir ${formatWib(earliest)}. Pakai sebelum tanggal itu.`,
  });
  const waSent = contact
    ? await sendMemberWa(
        contact,
        `Halo ${contact.name || "Member"}, saldo ARK Coin Anda sebesar ${rupiah(total)} (${ark} ARK) akan kedaluwarsa pada ${formatWib(earliest)}. Gunakan sebelum tanggal tersebut di outlet mana pun.`
      )
    : false;
  if (waSent) {
    await pool.query(`UPDATE pos.pos_wallet_lot_reminders SET wa_sent = true WHERE lot_id = ANY($1::uuid[])`, [
      claimed.map((p) => p.lot_id),
    ]);
  }
  return true;
}

async function sendExpiryReminders(settings: WalletSettings, now: Date) {
  if (settings.wallet_expiry_reminder_days <= 0) return 0;
  const horizon = new Date(now.getTime() + settings.wallet_expiry_reminder_days * 86_400_000);
  const { rows } = await getPool().query(
    `SELECT DISTINCT w.customer_id FROM pos.pos_wallet_transactions w
      WHERE w.expires_at > $1 AND w.expires_at <= $2 AND w.customer_id IS NOT NULL
        AND w.type = ANY($3::text[]) AND COALESCE(w.status, 'completed') = 'completed'
        AND NOT EXISTS (SELECT 1 FROM pos.pos_wallet_lot_reminders r WHERE r.lot_id = w.id)
      LIMIT ${BATCH}`,
    [now, horizon, LOT_TYPE_LIST]
  );
  let sent = 0;
  for (const { customer_id } of rows as { customer_id: string }[]) {
    try {
      if (await remindCustomer(customer_id, settings, now)) sent += 1;
    } catch (error) {
      console.error(`[wallet-sweep] pengingat member ${customer_id} gagal:`, error);
    }
  }
  return sent;
}

/* ── 3. Saldo rendah ─────────────────────────────────────────────────── */

async function sendLowBalanceNudges(settings: WalletSettings, now: Date) {
  const threshold = settings.low_balance_threshold_idr;
  if (threshold <= 0) return 0;
  const pool = getPool();
  const since = new Date(now.getTime() - LOW_BALANCE_NUDGE_COOLDOWN_DAYS * 86_400_000);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.wa_consent, COALESCE(c.ark_coin_balance, 0)::float AS balance,
            max(w.created_at) AS crossed_at,
            (SELECT max(n.sent_at) FROM pos.pos_wallet_low_balance_nudges n WHERE n.customer_id = c.id) AS last_nudge_at
       FROM pos.pos_customers c
       JOIN pos.pos_wallet_transactions w ON w.customer_id = c.id
      WHERE COALESCE(c.ark_coin_balance, 0) < $1
        AND w.created_at >= $2
        AND COALESCE(w.status, 'completed') = 'completed'
        AND w.balance_before >= $1 AND w.balance_after < $1
      GROUP BY c.id
      LIMIT ${BATCH}`,
    [threshold, since]
  );

  let sent = 0;
  for (const row of rows as (MemberContact & { id: string; balance: number; crossed_at: Date; last_nudge_at: Date | null })[]) {
    if (!shouldNudgeLowBalance({ threshold, balance: row.balance, crossedAt: row.crossed_at, lastNudgeAt: row.last_nudge_at, now })) {
      continue;
    }
    try {
      const { rows: nudge } = await pool.query(
        `INSERT INTO pos.pos_wallet_low_balance_nudges (customer_id, balance_idr, threshold_idr) VALUES ($1, $2, $3) RETURNING id`,
        [row.id, row.balance, threshold]
      );
      await notifyMember(pool, row.id, {
        type: "wallet_low_balance",
        title: "Saldo ARK Coin menipis",
        body: `Saldo Anda tinggal ${rupiah(row.balance)}. Top-up di kasir atau dari menu ARK Coin di portal.`,
      });
      const waSent = await sendMemberWa(
        row,
        `Halo ${row.name || "Member"}, saldo ARK Coin Anda tinggal ${rupiah(row.balance)}. Top-up sekarang di kasir atau lewat portal member agar transaksi berikutnya tetap lancar.`
      );
      if (waSent) await pool.query(`UPDATE pos.pos_wallet_low_balance_nudges SET wa_sent = true WHERE id = $1`, [nudge[0].id]);
      sent += 1;
    } catch (error) {
      console.error(`[wallet-sweep] dorongan saldo rendah ${row.id} gagal:`, error);
    }
  }
  return sent;
}

/* ── Orkestrasi ──────────────────────────────────────────────────────── */

export async function runWalletSweep(opts: { trigger: "auto" | "manual"; actorId?: string | null }): Promise<SweepResult> {
  const pool = getPool();
  const lockClient = await pool.connect();
  try {
    const { rows: lock } = await lockClient.query(`SELECT pg_try_advisory_lock($1) AS ok`, [SWEEP_LOCK_KEY]);
    if (!lock[0]?.ok) return { status: "busy", expired_lots: 0, expired_idr: 0, reminders_sent: 0, nudges_sent: 0 };
    const { rows: run } = await pool.query(
      `INSERT INTO pos.pos_wallet_sweep_runs (trigger, actor_id) VALUES ($1, $2) RETURNING id`,
      [opts.trigger, opts.actorId ?? null]
    );
    const runId = String(run[0].id);
    try {
      const now = new Date();
      const settings = await loadWalletSettings(pool);
      const expired = await sweepExpirations(settings, now, opts.trigger);
      const reminders = await sendExpiryReminders(settings, now);
      const nudges = await sendLowBalanceNudges(settings, now);
      await pool.query(
        `UPDATE pos.pos_wallet_sweep_runs
            SET finished_at = now(), expired_lots = $2, expired_idr = $3, reminders_sent = $4, nudges_sent = $5
          WHERE id = $1`,
        [runId, expired.lots, expired.idr, reminders, nudges]
      );
      return {
        status: "done",
        run_id: runId,
        expired_lots: expired.lots,
        expired_idr: expired.idr,
        reminders_sent: reminders,
        nudges_sent: nudges,
      };
    } catch (error) {
      await pool.query(`UPDATE pos.pos_wallet_sweep_runs SET finished_at = now(), error = $2 WHERE id = $1`, [
        runId,
        error instanceof Error ? error.message.slice(0, 500) : "error",
      ]);
      throw error;
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [SWEEP_LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}

export async function listSweepRuns(limit = 10) {
  const { rows } = await getPool().query(
    `SELECT id, trigger, started_at, finished_at, expired_lots, expired_idr::float AS expired_idr,
            reminders_sent, nudges_sent, error
       FROM pos.pos_wallet_sweep_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
