import "server-only";
/**
 * Gate check-in gym: scan QR, pipeline check-in booking (keanggotaan →
 * re-entry/anti-passback → booking → saldo), dan check-in manual front desk.
 * Setiap hasil dicatat di gym.access_logs.
 */
import type { PoolClient } from "pg";
import { notifyMember } from "@/lib/crm/engagement/server";
import { checkQrToken, formatWib } from "@/lib/crm/engagement/rules";
import { deductCredits, getCoveredClassTypeIds, getCreditBalance } from "@/lib/gym/credits-server";
import { isClassTypeCovered } from "@/lib/gym/credits";
import { getGymRules } from "@/lib/gym/rules";
import {
  CHECKIN_EARLY_MIN,
  CHECKIN_LATE_MIN,
  GATE_DENIAL_LABEL,
  TOKEN_DENIAL,
  canTransitionBooking,
  describeGateDecision,
  evaluateGateScan,
  type GateDenialReason,
  type GateEntryKind,
} from "./booking";
import { lockBookingWithSession, SchedulingError, sessionLabel } from "./booking-store";

export type CheckInSource = "gate" | "pos" | "manual";

export interface GymCheckInResult {
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entryKind: GateEntryKind | null;
  /** Penjelasan untuk staf, mis. "Tidak ada booking kelas". */
  message: string;
  customerId: string | null;
  memberName: string | null;
  booking: { id: string; sessionId: string; className: string; startsAt: Date } | null;
  creditsDeducted: number;
  balanceAfter: number | null;
}

async function logAccess(
  client: PoolClient,
  entry: {
    customerId: string | null;
    bookingId: string | null;
    branchId: string | null;
    result: Pick<GymCheckInResult, "decision" | "reason" | "entryKind" | "creditsDeducted">;
    source: CheckInSource;
    scannedBy: string | null;
  }
) {
  await client.query(
    `INSERT INTO gym.access_logs (customer_id, booking_id, branch_id, decision, reason, entry_kind, credit_delta, source, scanned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.customerId,
      entry.bookingId,
      entry.branchId,
      entry.result.decision,
      entry.result.reason,
      entry.result.entryKind,
      -entry.result.creditsDeducted,
      entry.source,
      entry.scannedBy,
    ]
  );
}

/**
 * Gate untuk member yang QR-nya sudah sah: keanggotaan → re-entry/anti-passback
 * → booking terkonfirmasi di cabang ini sekitar sekarang → saldo. Bila lolos,
 * kredit dipotong dan booking ditandai check-in dalam transaksi yang sama.
 * Setiap hasil dicatat di gym.access_logs. `token` diisi bila gate juga harus
 * mengonsumsi QR-nya.
 */
export async function checkInBooking(
  client: PoolClient,
  input: {
    customerId: string;
    branchId?: string | null;
    scannedBy: string | null;
    token?: string;
    source?: CheckInSource;
    now?: Date;
  }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const branchId = input.branchId ?? null;
  const { rows: members } = await client.query(`SELECT name, is_active FROM pos.pos_customers WHERE id = $1`, [
    input.customerId,
  ]);
  const { rows: lastEntry } = await client.query(
    `SELECT max(created_at) AS at FROM gym.access_logs WHERE customer_id = $1 AND decision = 'allowed'`,
    [input.customerId]
  );
  const { rows: candidates } = await client.query(
    `SELECT b.id, b.session_id, s.class_type_id, s.credit_cost, s.starts_at, t.name AS class_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
      WHERE b.customer_id = $1 AND b.status = 'confirmed'
        AND s.status IN ('published', 'full')
        AND ($2::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $2)
        AND s.starts_at <= $3::timestamptz + make_interval(mins => $4)
        AND s.ends_at >= $3::timestamptz - make_interval(mins => $5)
      ORDER BY s.starts_at
      LIMIT 1
      FOR UPDATE OF b`,
    [input.customerId, branchId, now, CHECKIN_EARLY_MIN, CHECKIN_LATE_MIN]
  );
  const rules = await getGymRules(client, branchId);
  const member = members[0];
  const candidate = candidates[0];
  // Kredit dari paket yang tidak mencakup kelas ini tidak bisa dipakai untuknya.
  const covered =
    !candidate || isClassTypeCovered(await getCoveredClassTypeIds(client, input.customerId), candidate.class_type_id);
  const balance = covered ? await getCreditBalance(client, input.customerId) : 0;

  const evaluation = evaluateGateScan({
    memberActive: Boolean(member) && member.is_active !== false,
    lastAllowedEntryAt: lastEntry[0]?.at ?? null,
    candidate: candidate ? { bookingId: candidate.id, creditCost: candidate.credit_cost } : null,
    balance,
    rules,
    now,
  });

  let decision = evaluation.decision;
  let reason = evaluation.reason;
  let creditsDeducted = 0;
  let balanceAfter: number | null = balance;

  for (const effect of evaluation.effects) {
    if (effect.kind === "consume_token" && input.token) {
      await client.query(`UPDATE crm.member_qr_tokens SET consumed_at = $2 WHERE token = $1 AND consumed_at IS NULL`, [
        input.token,
        now,
      ]);
    } else if (effect.kind === "deduct_credits") {
      const charged = await deductCredits(client, {
        customerId: input.customerId,
        amount: effect.amount,
        sourceType: "class_booking",
        sourceId: candidate.id,
        idempotencyKey: `gym:checkin:${candidate.id}`,
        note: `Check-in ${candidate.class_name}, ${formatWib(candidate.starts_at)}`,
      });
      // Saldo bisa berubah di antara baca dan potong: gate tetap tertutup.
      if (!charged.ok) {
        decision = "denied";
        reason = "insufficient_credits";
        break;
      }
      creditsDeducted = effect.amount;
      balanceAfter = charged.balanceAfter;
    } else if (effect.kind === "check_in_booking") {
      await client.query(
        `UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2, updated_at = now() WHERE id = $1`,
        [effect.bookingId, now]
      );
    }
  }

  const entryKind = decision === "allowed" ? evaluation.entryKind : null;
  const result: GymCheckInResult = {
    decision,
    reason,
    entryKind,
    message: describeGateDecision(
      { decision, reason, entryKind },
      { className: candidate?.class_name, credits: creditsDeducted, balanceAfter }
    ),
    customerId: input.customerId,
    memberName: member?.name ?? null,
    booking:
      entryKind === "booking"
        ? { id: candidate.id, sessionId: candidate.session_id, className: candidate.class_name, startsAt: candidate.starts_at }
        : null,
    creditsDeducted,
    balanceAfter,
  };
  await logAccess(client, {
    customerId: input.customerId,
    bookingId: candidate?.id ?? null,
    branchId,
    result,
    source: input.source ?? "gate",
    scannedBy: input.scannedBy,
  });
  if (entryKind === "booking") {
    await notifyMember(client, input.customerId, {
      type: "gym_checked_in",
      title: `Check-in: ${candidate.class_name}`,
      body: `${creditsDeducted} kredit dipotong. Sisa ${balanceAfter ?? 0} kredit. Selamat berlatih!`,
    });
  }
  return result;
}

/** Scan QR di gate/front desk gym: validasi token, lalu pipeline check-in. */
export async function scanGymQr(
  client: PoolClient,
  input: { token: string; branchId?: string | null; scannedBy: string | null; now?: Date }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const token = input.token.trim().toLowerCase();
  const { rows } = await client.query(
    `SELECT token, customer_id, expires_at, consumed_at FROM crm.member_qr_tokens WHERE token = $1 FOR UPDATE`,
    [token]
  );
  const row = rows[0] ?? null;
  const problem = checkQrToken(row, now);
  if (!problem) {
    return checkInBooking(client, { customerId: row.customer_id, branchId: input.branchId, scannedBy: input.scannedBy, token, now });
  }
  const reason = TOKEN_DENIAL[problem];
  const result: GymCheckInResult = {
    decision: "denied",
    reason,
    entryKind: null,
    message: GATE_DENIAL_LABEL[reason],
    customerId: row?.customer_id ?? null,
    memberName: null,
    booking: null,
    creditsDeducted: 0,
    balanceAfter: null,
  };
  await logAccess(client, {
    customerId: result.customerId,
    bookingId: null,
    branchId: input.branchId ?? null,
    result,
    source: "gate",
    scannedBy: input.scannedBy,
  });
  return result;
}

/**
 * Front desk meng-check-in booking tertentu dari daftar peserta (tanpa QR).
 * Kredit dipotong sama seperti di gate; anti-passback dan jendela waktu tidak
 * berlaku karena staf yang memutuskan.
 */
export async function checkInBookingManually(
  client: PoolClient,
  input: { bookingId: string; scannedBy: string | null; now?: Date }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const { booking, session } = await lockBookingWithSession(client, input.bookingId);
  if (!canTransitionBooking(booking.status, "checked_in")) {
    throw new SchedulingError("Hanya booking terkonfirmasi yang bisa check-in");
  }
  if (!isClassTypeCovered(await getCoveredClassTypeIds(client, booking.customer_id), session.class_type_id)) {
    throw new SchedulingError("Paket kredit member tidak mencakup kelas ini");
  }
  const charged = await deductCredits(client, {
    customerId: booking.customer_id,
    amount: session.credit_cost,
    sourceType: "class_booking",
    sourceId: booking.id,
    idempotencyKey: `gym:checkin:${booking.id}`,
    note: `Check-in ${sessionLabel(session)} (front desk)`,
  });
  if (!charged.ok) throw new SchedulingError("Kredit member tidak cukup untuk kelas ini");
  await client.query(
    `UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2, updated_at = now() WHERE id = $1`,
    [booking.id, now]
  );
  const result: GymCheckInResult = {
    decision: "allowed",
    reason: null,
    entryKind: "booking",
    message: describeGateDecision(
      { decision: "allowed", reason: null, entryKind: "booking" },
      { className: session.class_type_name, credits: session.credit_cost, balanceAfter: charged.balanceAfter }
    ),
    customerId: booking.customer_id,
    memberName: null,
    booking: { id: booking.id, sessionId: session.id, className: session.class_type_name, startsAt: session.starts_at },
    creditsDeducted: session.credit_cost,
    balanceAfter: charged.balanceAfter,
  };
  await logAccess(client, {
    customerId: booking.customer_id,
    bookingId: booking.id,
    branchId: session.branch_id,
    result,
    source: "manual",
    scannedBy: input.scannedBy,
  });
  return result;
}
