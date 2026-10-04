import { ApiError } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import type { AccountTypePayload } from "@/lib/accounting/schemas";

const SELECT = "id, code, name, normal_balance, sort_order, is_active, created_at, updated_at";
const DUPLICATE_CODE = "Kode account type sudah digunakan";

function fields(body: AccountTypePayload) {
  return {
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    normal_balance: body.normal_balance,
    sort_order: body.sort_order ?? 0,
    is_active: body.is_active ?? true,
  };
}

export async function listAccountTypes() {
  const db = await createServerPgClient();
  const { data, error } = await db
    .from("account_types", "accounting")
    .select(SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createAccountType(userId: string, body: AccountTypePayload) {
  const db = await createServerPgClient();
  const { data, error } = await db
    .from("account_types", "accounting")
    .insert({ ...fields(body), created_by: userId, updated_by: userId })
    .select(SELECT)
    .single();
  if (error?.code === "23505") throw ApiError.badRequest(DUPLICATE_CODE);
  if (error) throw error;
  return data;
}

export async function updateAccountType(id: string, userId: string, body: AccountTypePayload) {
  const db = await createServerPgClient();
  const { data, error } = await db
    .from("account_types", "accounting")
    .update({ ...fields(body), updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error?.code === "23505") throw ApiError.badRequest(DUPLICATE_CODE);
  if (error) throw error;
  if (!data) throw ApiError.notFound("Account type tidak ditemukan");
  return data;
}

/** Hapus permanen; ditolak bila masih dipakai akun COA aktif. */
export async function deleteAccountType(id: string) {
  const db = await createServerPgClient();
  const { count } = await db
    .from("chart_of_accounts", "accounting")
    .select("id", { count: "exact", head: true })
    .eq("account_type_id", id)
    .is("deleted_at", null);
  if (count && count > 0) {
    throw ApiError.badRequest(`Tidak dapat dihapus — masih dipakai ${count} akun COA`);
  }
  const { error } = await db.from("account_types", "accounting").delete().eq("id", id);
  if (error) throw error;
}
