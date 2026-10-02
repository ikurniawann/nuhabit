import { NextResponse } from "next/server";
import { ApiError, requireIamAction, requireIamMenuPrefix, type ApiUser } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";

/**
 * Konteks venue modul Studio (EPIC-052) — pola sama dengan Resort: scope bisnis
 * user, fallback default venue di CRM Settings supaya super admin (tanpa scope)
 * tetap bisa memakai modul. Semua query difilter `branch_id`.
 */

export interface StudioContext {
  user: ApiUser;
  companyId: string;
  branchId: string;
}

async function resolveVenue(): Promise<{ companyId: string | null; branchId: string | null }> {
  const scope = await getApiUserScope();
  let companyId = scope?.companyId ?? null;
  let branchId = scope?.branchId ?? null;
  if (companyId && branchId) return { companyId, branchId };
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`
  ).catch(() => []);
  for (const row of rows) {
    const value = typeof row.value === "string" ? row.value : String(row.value ?? "").replace(/"/g, "");
    if (!value) continue;
    if (row.key === "default_company_id" && !companyId) companyId = value;
    if (row.key === "default_branch_id" && !branchId) branchId = value;
  }
  return { companyId, branchId };
}

export async function requireStudioContext(action?: "create" | "update" | "delete"): Promise<StudioContext> {
  const user = action ? await requireIamAction(IAM.studio, action) : await requireIamMenuPrefix(IAM.studio);
  const { companyId, branchId } = await resolveVenue();
  if (!companyId || !branchId) {
    throw ApiError.conflict("Venue belum dikonfigurasi — lengkapi scope bisnis user atau default venue di CRM Settings");
  }
  return { user, companyId, branchId };
}

/** Bungkus handler route: ApiError → respons terstruktur, sisanya 500 + log. */
export async function studioRoute(label: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const pg = error as { code?: string; detail?: string };
    if (pg?.code === "23505") {
      return NextResponse.json({ success: false, error: "Data yang sama sudah ada" }, { status: 409 });
    }
    if (pg?.code === "23503") {
      return NextResponse.json({ success: false, error: "Data masih dipakai di tempat lain" }, { status: 409 });
    }
    console.error(`[studio] ${label}:`, error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

/** Bangun klausa SET dari body yang sudah divalidasi zod (kunci = kolom). */
export function buildSet(body: Record<string, unknown>, firstIndex = 2): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${key} = $${firstIndex + values.length - 1}`);
  }
  return { sets, values };
}

// ── Loader bersama ─────────────────────────────────────────────────────────

export const COACH_COLUMNS = `c.id, c.employee_id, c.full_name, c.display_name, c.level, c.phone, c.email,
  c.photo_url, c.bio, c.certifications, c.specialties, c.is_public, c.is_active, c.sort_order,
  e.full_name AS employee_name, e.nip AS employee_nip`;

export async function loadCoaches(branchId: string, onlyActive = false) {
  return query(
    `SELECT ${COACH_COLUMNS}
     FROM studio.coaches c
     LEFT JOIN hris.employees e ON e.id = c.employee_id
     WHERE c.branch_id = $1 ${onlyActive ? "AND c.is_active" : ""}
     ORDER BY c.is_active DESC, CASE c.level WHEN 'head_coach' THEN 0 ELSE 1 END, c.sort_order, c.full_name`,
    [branchId]
  );
}

export async function loadPrograms(branchId: string, onlyActive = false) {
  return query(
    `SELECT p.id, p.code, p.name, p.kind, p.description, p.duration_minutes, p.default_capacity,
            p.level_label, p.is_active, p.sort_order
     FROM studio.programs p
     WHERE p.branch_id = $1 ${onlyActive ? "AND p.is_active" : ""}
     ORDER BY p.is_active DESC, p.sort_order, p.name`,
    [branchId]
  );
}

export async function loadTemplates(branchId: string) {
  return query(
    `SELECT t.id, t.weekday, to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time,
            t.program_id, p.name AS program_name, p.kind AS program_kind,
            t.coach_id, c.full_name AS coach_name, c.level AS coach_level,
            t.capacity, t.notes, t.is_active
     FROM studio.schedule_templates t
     JOIN studio.programs p ON p.id = t.program_id
     LEFT JOIN studio.coaches c ON c.id = t.coach_id
     WHERE t.branch_id = $1
     ORDER BY t.weekday, t.start_time, p.name`,
    [branchId]
  );
}

export async function loadSessions(branchId: string, from: string, to: string) {
  return query(
    `SELECT s.id, s.session_date::text AS session_date,
            to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time,
            s.program_id, p.name AS program_name, p.kind AS program_kind,
            s.coach_id, c.full_name AS coach_name, c.level AS coach_level,
            s.capacity, s.status, s.template_id, s.cancel_reason, s.notes
     FROM studio.class_sessions s
     JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches c ON c.id = s.coach_id
     WHERE s.branch_id = $1 AND s.session_date BETWEEN $2::date AND $3::date
     ORDER BY s.session_date, s.start_time, p.name`,
    [branchId, from, to]
  );
}

/** Pastikan id milik venue ini; lempar 404 bila tidak. */
export async function assertInBranch(table: "coaches" | "programs" | "schedule_templates" | "class_sessions", id: string, branchId: string, label: string) {
  const rows = await query<{ id: string }>(`SELECT id FROM studio.${table} WHERE id = $1 AND branch_id = $2`, [id, branchId]);
  if (rows.length === 0) throw ApiError.notFound(`${label} tidak ditemukan`);
}
