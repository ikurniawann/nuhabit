// Koreksi XP: tarik XP order yang di-void dan penyesuaian manual admin.
import type { DbClient } from "@/lib/pg/types";
import { isMissingCrmSchema, toNumber } from "@/lib/crm/server";
import { ensureMemberProfile } from "./loyalty-ledger";
import {
  clampXpAdjustment,
  sumUnreversedEarnByOrder,
  voidReverseKey,
  type PosCustomerLoyaltyRow,
  type XpEarnRow,
} from "./loyalty-rules";
import { syncTierAfterEarn } from "./loyalty-tier-sync";

async function readTotalXp(db: DbClient, customerId: string) {
  const result = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();
  return { ...result, totalXp: toNumber((result.data as PosCustomerLoyaltyRow | null)?.total_xp) };
}

/**
 * Tarik kembali XP order yang di-void (keputusan owner 2026-08-23): saldo ARK
 * di-refund, statistik belanja dikoreksi, maka XP juga harus dibatalkan.
 *
 * Cara kerja: jumlahkan baris `earn` ledger yang mereferensikan order-order
 * tsb, tulis satu baris `reverse` per order (idempoten via idempotency_key
 * `pos:order:<id>:void_reverse` — retry void tidak dobel-tarik), turunkan
 * pos_customers.total_xp (kanonik) + mirror lifetime_xp profil (clamp ≥ 0,
 * sesuai constraint ledger), lalu sinkron ulang tier — tier BISA turun.
 */
export async function reverseCrmXpForVoidedOrders(
  db: DbClient,
  payload: { orderIds: string[]; voidReason?: string | null }
): Promise<{ xpReversed: number }> {
  if (payload.orderIds.length === 0) return { xpReversed: 0 };

  try {
    const { data: earnRows, error: earnError } = await db
      .from("crm_xp_ledger")
      .select("id, customer_id, member_id, xp_delta, outlet_id, company_id, branch_id, reference_id")
      .eq("reference_table", "pos_orders")
      .eq("direction", "earn")
      .in("reference_id", payload.orderIds);
    if (earnError) throw earnError;
    if (!earnRows || earnRows.length === 0) return { xpReversed: 0 };

    const { data: existingReverse } = await db
      .from("crm_xp_ledger")
      .select("idempotency_key")
      .in("idempotency_key", payload.orderIds.map(voidReverseKey));
    const alreadyReversed = new Set(
      ((existingReverse ?? []) as Array<{ idempotency_key?: unknown }>).map((row) =>
        String(row.idempotency_key)
      )
    );

    const xpByOrder = sumUnreversedEarnByOrder(earnRows as XpEarnRow[], alreadyReversed);
    if (xpByOrder.size === 0) return { xpReversed: 0 };

    const customerId = String([...xpByOrder.values()][0].row.customer_id);

    let xpReversed = 0;
    for (const [orderId, entry] of xpByOrder) {
      if (entry.xp <= 0) continue;

      const { totalXp: lifetimeBefore } = await readTotalXp(db, customerId);
      // Clamp: XP member tidak boleh negatif (constraint ledger juga menolak).
      const delta = Math.min(entry.xp, lifetimeBefore);
      if (delta <= 0) continue;
      const lifetimeAfter = lifetimeBefore - delta;

      const { error: ledgerError } = await db.from("crm_xp_ledger").insert({
        member_id: entry.row.member_id,
        customer_id: customerId,
        direction: "reverse",
        source_channel: "pos",
        source_type: "order_void",
        source_id: orderId,
        outlet_id: entry.row.outlet_id,
        company_id: entry.row.company_id,
        branch_id: entry.row.branch_id,
        xp_delta: -delta,
        balance_before: lifetimeBefore,
        balance_after: lifetimeAfter,
        lifetime_before: lifetimeBefore,
        lifetime_after: lifetimeAfter,
        reference_table: "pos_orders",
        reference_id: orderId,
        idempotency_key: voidReverseKey(orderId),
        description: `Pembatalan XP — void order${payload.voidReason ? ` (${payload.voidReason})` : ""}`,
        metadata: { void: true },
      });
      if (ledgerError) {
        // 23505 = reversal sudah tercatat oleh proses lain — bukan error.
        if ((ledgerError as { code?: string }).code === "23505") continue;
        throw ledgerError;
      }

      await db
        .from("pos_customers")
        .update({ total_xp: lifetimeAfter, updated_at: new Date().toISOString() })
        .eq("id", customerId);
      await db
        .from("crm_member_profiles")
        .update({ lifetime_xp: lifetimeAfter, loyalty_score: lifetimeAfter })
        .eq("id", entry.row.member_id);

      xpReversed += delta;
    }

    if (xpReversed > 0) await syncTierAfterEarn(db, customerId);
    return { xpReversed };
  } catch (error) {
    if (isMissingCrmSchema(error)) return { xpReversed: 0 };
    throw error;
  }
}

/**
 * Penyesuaian XP manual oleh admin (positif atau negatif) dengan alasan.
 * Satu `requestId` = satu baris ledger, jadi klik ganda tidak menggandakan.
 * Pengurangan dijepit agar XP tidak negatif; tier dievaluasi ulang (bisa turun).
 */
export async function adjustMemberXp(
  db: DbClient,
  input: {
    customerId: string;
    delta: number;
    reason: string;
    actorId: string;
    requestId: string;
    companyId?: string | null;
    branchId?: string | null;
  }
): Promise<{ status: "posted" | "duplicate" | "skipped"; xpDelta: number; totalXp: number }> {
  const idempotencyKey = `admin-adjust:${input.requestId}`;
  const existing = await db
    .from("crm_xp_ledger")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const { error: customerError, totalXp: before } = await readTotalXp(db, input.customerId);
  if (customerError) throw customerError;
  if (existing.data) return { status: "duplicate", xpDelta: 0, totalXp: before };

  const applied = clampXpAdjustment(input.delta, before);
  const member = applied !== 0 ? await ensureMemberProfile(db, input.customerId) : null;
  if (!member || applied === 0) return { status: "skipped", xpDelta: 0, totalXp: before };
  const after = before + applied;

  const { error: ledgerError } = await db.from("crm_xp_ledger").insert({
    member_id: member.id,
    customer_id: input.customerId,
    direction: "adjust",
    source_channel: "manual",
    source_type: "admin_adjustment",
    source_id: input.actorId,
    company_id: input.companyId ?? null,
    branch_id: input.branchId ?? null,
    xp_delta: applied,
    balance_before: before,
    balance_after: after,
    lifetime_before: before,
    lifetime_after: after,
    reference_table: "pos_customers",
    reference_id: input.customerId,
    idempotency_key: idempotencyKey,
    description: `Penyesuaian admin: ${input.reason}`,
    metadata: { reason: input.reason, actor_id: input.actorId, requested_delta: Math.trunc(input.delta) },
  });
  if (ledgerError) {
    if ((ledgerError as { code?: string }).code === "23505") {
      return { status: "duplicate", xpDelta: 0, totalXp: before };
    }
    throw ledgerError;
  }

  const now = new Date().toISOString();
  await db.from("pos_customers").update({ total_xp: after, updated_at: now }).eq("id", input.customerId);
  await db
    .from("crm_member_profiles")
    .update({ lifetime_xp: after, loyalty_score: after, last_activity_at: now })
    .eq("id", member.id);
  await syncTierAfterEarn(db, input.customerId);
  return { status: "posted", xpDelta: applied, totalXp: after };
}
