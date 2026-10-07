import "server-only";
import { query, queryOne } from "@/lib/db";
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

// ── Batas percobaan PIN supervisor ──────────────────────────────────────────

export const SUPERVISOR_PIN_SCOPE = "pos_supervisor_pin";
/** 5 PIN salah dalam 15 menit → kasir (dan order, bila ada) terkunci 15 menit. */
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

export type SupervisorPinApproval =
  | { ok: true; supervisor: ApprovedSupervisor }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryMinutes: number };

type SupervisorCandidate = ScopedUserRow & SupervisorPinRow;

async function activeSupervisors(): Promise<SupervisorCandidate[]> {
  return query<SupervisorCandidate>(
    `SELECT ${SCOPE_COLUMNS}, full_name, pos_pin
       FROM configuration.users
      WHERE role = 'pos_supervisor' AND status = 'active' AND pos_pin IS NOT NULL`
  );
}

/**
 * Kerangka bersama: tolak bila subject terkunci, cari supervisor, catat gagal
 * atau bersihkan hitungan. `find` mengembalikan null untuk PIN salah.
 */
async function approveWithAttemptLimit(
  subjects: string[],
  find: () => Promise<SupervisorCandidate | null>
): Promise<SupervisorPinApproval> {
  const existingLock = await findActiveLock(SUPERVISOR_PIN_SCOPE, subjects);
  if (existingLock) return { ok: false, reason: "locked", retryMinutes: minutesUntil(existingLock, new Date()) };

  const supervisor = await find();
  if (!supervisor) {
    const lock = await recordFailure(SUPERVISOR_PIN_SCOPE, subjects, SUPERVISOR_PIN_POLICY);
    return lock ? { ok: false, reason: "locked", retryMinutes: minutesUntil(lock, new Date()) } : { ok: false, reason: "invalid" };
  }
  await clearFailures(SUPERVISOR_PIN_SCOPE, subjects);
  return { ok: true, supervisor: { id: supervisor.id, name: supervisor.full_name || "Supervisor" } };
}

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
}): Promise<SupervisorPinApproval> {
  const pin = String(input.pin || "").trim();
  const order = input.order;
  return approveWithAttemptLimit([`user:${input.callerId}`, `order:${input.orderId}`], async () => {
    if (!order || !pin || !(await isOrderInUserScope(input.callerId, order))) return null;
    return findSupervisorByPin(supervisorsForOrder(await activeSupervisors(), order), pin);
  });
}

/**
 * Verifikasi PIN supervisor tanpa order (FOC, top-up FOC, refund member):
 * hanya supervisor aktif yang scope-nya mencakup company/cabang kasir.
 * Kegagalan dihitung per kasir di DB (anggaran sama dengan void/merge).
 */
export async function approveWithSupervisorPin(input: {
  callerId: string;
  pin: string;
}): Promise<SupervisorPinApproval> {
  const pin = String(input.pin || "").trim();
  return approveWithAttemptLimit([`user:${input.callerId}`], async () => {
    if (!pin) return null;
    const caller = await queryOne<ScopedUserRow>(
      `SELECT ${SCOPE_COLUMNS} FROM configuration.users WHERE id = $1`,
      [input.callerId]
    );
    if (!caller) return null;
    const callerUnit = { company_id: caller.company_id, branch_id: caller.branch_id };
    return findSupervisorByPin(supervisorsForOrder(await activeSupervisors(), callerUnit), pin);
  });
}

/** Respons tolak standar: 429 saat terkunci, 403 untuk PIN salah. */
export function supervisorPinRejection(approval: Exclude<SupervisorPinApproval, { ok: true }>): Response {
  return approval.reason === "locked"
    ? Response.json({ success: false, error: supervisorPinLockedMessage(approval.retryMinutes) }, { status: 429 })
    : Response.json({ success: false, error: "PIN supervisor tidak valid" }, { status: 403 });
}

/** Pesan 429 yang sama untuk void & merge. */
export function supervisorPinLockedMessage(retryMinutes: number): string {
  return `Terlalu banyak percobaan PIN supervisor. Coba lagi dalam ${retryMinutes} menit.`;
}
