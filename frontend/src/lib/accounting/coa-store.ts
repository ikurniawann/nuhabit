import { ApiError } from "@/lib/api/auth";
import { isRowInBusinessScope, type UserScope } from "@/lib/api/scope";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  formatAccountCodeDisplay,
  inferAccountLevel,
  normalizeAccountCode,
} from "@/lib/accounting/account-code";
import { recomputePostableChain } from "@/lib/accounting/coa-postable";
import type { ChartOfAccountPayload } from "@/lib/accounting/schemas";

const SELECT = `
  id, company_id, code, name, parent_id, account_type_id, level,
  is_postable, is_contra, is_cash_bank, cash_flow_category, description, is_active,
  created_at, updated_at,
  account_types ( id, code, name, normal_balance )
`.replace(/\s+/g, " ");

const BOOLEAN_FILTERS = ["is_postable", "is_contra", "is_cash_bank", "is_active"] as const;

function mapRow(row: Record<string, unknown>) {
  const type = row.account_types as
    | { id: string; code: string; name: string; normal_balance: string }
    | null
    | undefined;
  return {
    id: row.id,
    company_id: row.company_id,
    code: row.code,
    code_display: formatAccountCodeDisplay(String(row.code)),
    name: row.name,
    parent_id: row.parent_id,
    account_type_id: row.account_type_id,
    account_type_code: type?.code ?? null,
    account_type_name: type?.name ?? null,
    normal_balance: type?.normal_balance ?? null,
    level: row.level,
    is_postable: row.is_postable,
    is_contra: row.is_contra,
    is_cash_bank: row.is_cash_bank,
    cash_flow_category: row.cash_flow_category,
    description: row.description,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Kode + level dari input user; 400 bila format tidak dikenali. */
function resolveCode(rawCode: string) {
  const code = normalizeAccountCode(rawCode);
  if (!code) throw ApiError.badRequest("Format kode akun tidak valid");
  const level = inferAccountLevel(code);
  if (!level) throw ApiError.badRequest("Level kode akun tidak dikenali");
  return { code, level };
}

function editableFields(body: ChartOfAccountPayload) {
  return {
    name: body.name.trim(),
    parent_id: body.parent_id ?? null,
    account_type_id: body.account_type_id,
    is_contra: body.is_contra ?? false,
    is_cash_bank: body.is_cash_bank ?? false,
    cash_flow_category: body.cash_flow_category ?? null,
    description: body.description?.trim() || null,
    is_active: body.is_active ?? true,
  };
}

async function fetchMapped(id: string, fallback: Record<string, unknown>) {
  const db = await createServerPgClient();
  const { data } = await db
    .from("chart_of_accounts", "accounting")
    .select(SELECT)
    .eq("id", id)
    .single();
  return mapRow((data ?? fallback) as Record<string, unknown>);
}

async function loadScopedAccount(id: string, scope: UserScope | null) {
  const db = await createServerPgClient();
  const { data: existing } = await db
    .from("chart_of_accounts", "accounting")
    .select("id, company_id, parent_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.deleted_at) throw ApiError.notFound("Akun tidak ditemukan");
  if (!isRowInBusinessScope(scope, existing)) throw ApiError.forbidden("Akun di luar scope");
  return existing as { id: string; company_id: string | null; parent_id: string | null };
}

export async function listChartOfAccounts(companyId: string, sp: URLSearchParams) {
  const db = await createServerPgClient();
  let q = db
    .from("chart_of_accounts", "accounting")
    .select(SELECT)
    .is("deleted_at", null)
    .eq("company_id", companyId)
    .order("code", { ascending: true });

  const typeId = sp.get("account_type_id");
  if (typeId) q = q.eq("account_type_id", typeId);
  for (const key of BOOLEAN_FILTERS) {
    const value = sp.get(key);
    if (value === "true" || value === "false") q = q.eq(key, value === "true");
  }
  const cashFlow = sp.get("cash_flow_category");
  if (cashFlow) q = q.eq("cash_flow_category", cashFlow);
  const search = sp.get("search")?.trim();
  if (search) q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

export async function createChartOfAccount(opts: {
  userId: string;
  companyId: string;
  scope: UserScope | null;
  body: ChartOfAccountPayload;
}) {
  const { userId, companyId, scope, body } = opts;
  const { code, level } = resolveCode(body.code);
  const db = await createServerPgClient();

  if (body.parent_id) {
    const { data: parent } = await db
      .from("chart_of_accounts", "accounting")
      .select("id, company_id, level, deleted_at")
      .eq("id", body.parent_id)
      .maybeSingle();
    if (!parent || parent.deleted_at) throw ApiError.badRequest("Parent akun tidak ditemukan");
    if (!isRowInBusinessScope(scope, parent)) throw ApiError.forbidden("Parent di luar scope");
    if ((parent.company_id ?? null) !== companyId) {
      throw ApiError.badRequest("Parent harus dalam company yang sama");
    }
  }

  const { data, error } = await db
    .from("chart_of_accounts", "accounting")
    .insert({
      ...editableFields(body),
      company_id: companyId,
      code,
      level,
      is_postable: true,
      created_by: userId,
      updated_by: userId,
    })
    .select(SELECT)
    .single();
  if (error?.code === "23505") throw ApiError.badRequest("Kode akun sudah digunakan");
  if (error) throw error;

  await recomputePostableChain(body.parent_id ?? null);
  await recomputePostableChain(data.id);
  return fetchMapped(data.id, data);
}

export async function updateChartOfAccount(opts: {
  id: string;
  userId: string;
  scope: UserScope | null;
  body: ChartOfAccountPayload;
}) {
  const { id, userId, scope, body } = opts;
  const existing = await loadScopedAccount(id, scope);
  const { code, level } = resolveCode(body.code);
  if (body.parent_id === id) throw ApiError.badRequest("Parent tidak boleh akun itu sendiri");

  const db = await createServerPgClient();
  const { data, error } = await db
    .from("chart_of_accounts", "accounting")
    .update({
      ...editableFields(body),
      code,
      level,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error?.code === "23505") throw ApiError.badRequest("Kode akun sudah digunakan");
  if (error) throw error;

  await recomputePostableChain(existing.parent_id);
  await recomputePostableChain(body.parent_id ?? null);
  await recomputePostableChain(id);
  return fetchMapped(id, data);
}

export async function softDeleteChartOfAccount(opts: {
  id: string;
  userId: string;
  scope: UserScope | null;
}) {
  const { id, userId, scope } = opts;
  const existing = await loadScopedAccount(id, scope);
  const db = await createServerPgClient();

  const { count } = await db
    .from("chart_of_accounts", "accounting")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id)
    .is("deleted_at", null);
  if (count && count > 0) {
    throw ApiError.badRequest(`Tidak dapat dihapus — masih ada ${count} akun anak`);
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("chart_of_accounts", "accounting")
    .update({ deleted_at: now, deleted_by: userId, is_active: false, updated_by: userId, updated_at: now })
    .eq("id", id);
  if (error) throw error;

  await recomputePostableChain(existing.parent_id);
}
