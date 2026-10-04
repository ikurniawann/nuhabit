import { query, queryOne } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { isOperationalRowInBusinessScope, type UserScope } from "@/lib/api/scope";
import type { BusinessScopeLevel } from "@/lib/configuration/business-scope";
import {
  clearFailures,
  findActiveLock,
  minutesUntil,
  recordFailure,
  type AttemptPolicy,
} from "@/lib/security/attempt-limit";
import { findSupervisorByPin, type SupervisorPinRow } from "./supervisor-pin";

export interface ApprovedSupervisor {
  id: string;
  name: string;
}

/**
 * Verifikasi PIN supervisor POS di sisi server — dipakai gerbang yang
 * membutuhkan persetujuan supervisor (Void/Merge/Owner Comp/metode FOC).
 * Mengembalikan identitas supervisor yang cocok, atau null bila PIN salah.
 */
export async function verifySupervisorPinServer(
  pin: string
): Promise<ApprovedSupervisor | null> {
  const trimmed = String(pin || "").trim();
  if (!trimmed) return null;
  const db = createPgClient();
  const { data } = await db
    .from("users")
    .select("id, full_name, role, pos_pin")
    .eq("role", "pos_supervisor");
  const supervisor = await findSupervisorByPin(
    (data ?? []) as Array<{ id: string; full_name: string | null; pos_pin: string | null }>,
    trimmed
  );
  if (!supervisor) return null;
  return { id: supervisor.id, name: supervisor.full_name || "Supervisor" };
}

// ── Persetujuan PIN untuk SATU order (void / merge) ─────────────────────────

export const SUPERVISOR_PIN_SCOPE = "pos_supervisor_pin";
/** 5 PIN salah dalam 15 menit → kasir dan order itu terkunci 15 menit. */
export const SUPERVISOR_PIN_POLICY: AttemptPolicy = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
};

export type OrderScopeRow = { company_id: string | null; branch_id: string | null };

type ScopedUserRow = {
  id: string;
  role: string | null;
  business_scope: BusinessScopeLevel | null;
  holding_id: string | null;
  company_id: string | null;
  branch_id: string | null;
};

/** Murni: baris configuration.users → UserScope (aturan sama dgn getApiUserScope). */
export function toUserScope(row: ScopedUserRow): UserScope {
  return {
    userId: row.id,
    role: row.role,
    businessScope: row.business_scope,
    holdingId: row.holding_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    isUnscoped: row.role === "super_admin" || !row.business_scope,
  };
}

const SCOPE_COLUMNS = "id, role, business_scope, holding_id, company_id, branch_id";

/** Order berada dalam scope bisnis user (pola dokumen operasional: kolom null mewarisi). */
export async function isOrderInUserScope(userId: string, order: OrderScopeRow): Promise<boolean> {
  const row = await queryOne<ScopedUserRow>(
    `SELECT ${SCOPE_COLUMNS} FROM configuration.users WHERE id = $1`,
    [userId]
  );
  return Boolean(row) && isOperationalRowInBusinessScope(toUserScope(row!), order);
}

/** Murni: hanya supervisor yang scope-nya mencakup order yang boleh menyetujui. */
export function supervisorsForOrder<T extends ScopedUserRow>(supervisors: T[], order: OrderScopeRow): T[] {
  return supervisors.filter((supervisor) => isOperationalRowInBusinessScope(toUserScope(supervisor), order));
}

export type OrderPinApproval =
  | { ok: true; supervisor: ApprovedSupervisor }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryMinutes: number };

/**
 * Verifikasi PIN supervisor untuk satu order. `order` = null bila order tidak
 * ada atau di luar scope kasir: hasilnya sama persis dengan PIN salah (tidak
 * membocorkan keberadaan order) dan ikut dihitung sebagai kegagalan.
 * Kegagalan dihitung per kasir DAN per order, disimpan di DB.
 */
export async function approveOrderWithSupervisorPin(input: {
  callerId: string;
  orderId: string;
  order: OrderScopeRow | null;
  pin: string;
}): Promise<OrderPinApproval> {
  const subjects = [`user:${input.callerId}`, `order:${input.orderId}`];
  const now = new Date();
  const existingLock = await findActiveLock(SUPERVISOR_PIN_SCOPE, subjects);
  if (existingLock) return { ok: false, reason: "locked", retryMinutes: minutesUntil(existingLock, now) };

  const pin = String(input.pin || "").trim();
  let supervisor: (ScopedUserRow & SupervisorPinRow) | null = null;
  if (input.order && pin && (await isOrderInUserScope(input.callerId, input.order))) {
    const rows = await query<ScopedUserRow & SupervisorPinRow>(
      `SELECT ${SCOPE_COLUMNS}, full_name, pos_pin
         FROM configuration.users
        WHERE role = 'pos_supervisor' AND status = 'active' AND pos_pin IS NOT NULL`
    );
    supervisor = await findSupervisorByPin(supervisorsForOrder(rows, input.order), pin);
  }

  if (!supervisor) {
    const lock = await recordFailure(SUPERVISOR_PIN_SCOPE, subjects, SUPERVISOR_PIN_POLICY);
    return lock ? { ok: false, reason: "locked", retryMinutes: minutesUntil(lock, new Date()) } : { ok: false, reason: "invalid" };
  }
  await clearFailures(SUPERVISOR_PIN_SCOPE, subjects);
  return { ok: true, supervisor: { id: supervisor.id, name: supervisor.full_name || "Supervisor" } };
}

/** Pesan 429 yang sama untuk void & merge. */
export function supervisorPinLockedMessage(retryMinutes: number): string {
  return `Terlalu banyak percobaan PIN supervisor. Coba lagi dalam ${retryMinutes} menit.`;
}
