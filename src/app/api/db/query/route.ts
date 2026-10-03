import { NextResponse } from "next/server";
import { QueryBuilder } from "@/lib/pg/query-builder";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import {
  DB_QUERY_FORBIDDEN_CODE,
  DB_QUERY_FORBIDDEN_MESSAGE,
  evaluateDbQuery,
  isDbAction,
  isSafeIdentifier,
  type DbFilter,
} from "@/lib/pg/query-policy";
import type { UserRole } from "@/types";

/**
 * Tabel tanpa schema (klien memanggil .from("candidates")) di-resolve lewat
 * search_path koneksi, sama seperti QueryBuilder. Hasilnya dipakai untuk cek
 * policy DAN untuk eksekusi, jadi tabel yang dicek = tabel yang dijalankan.
 */
async function resolveSchema(schema: unknown, table: string): Promise<string | null> {
  if (typeof schema === "string" && schema !== "" && schema !== "public") return schema;
  const row = await queryOne<{ nspname: string }>(
    `SELECT n.nspname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.oid = to_regclass(quote_ident($1))`,
    [table]
  );
  return row?.nspname ?? null;
}

function forbidden() {
  return NextResponse.json(
    { data: null, error: { message: DB_QUERY_FORBIDDEN_MESSAGE, code: DB_QUERY_FORBIDDEN_CODE } },
    { status: 403 }
  );
}

export async function POST(request: Request) {
  const user = await getSessionUserFromCookies();
  if (!user) {
    return NextResponse.json({ data: null, error: { message: "Authentication required" } }, { status: 401 });
  }

  try {
    const spec = await request.json();
    const action = spec?.action ?? "select";
    const table = spec?.table;
    const filters: DbFilter[] = Array.isArray(spec?.filters) ? spec.filters : [];
    const orFilters: string[] = Array.isArray(spec?.orFilters)
      ? spec.orFilters.filter((f: unknown): f is string => typeof f === "string")
      : [];

    const schema = isSafeIdentifier(table) ? await resolveSchema(spec.schema, table) : null;
    const profile = await queryOne<{ role: UserRole }>(
      `SELECT role FROM configuration.users WHERE id = $1`,
      [user.id]
    );
    const role = profile?.role ?? null;

    const decision =
      schema && isDbAction(action)
        ? evaluateDbQuery({
            schema,
            table,
            action,
            select: spec.select,
            returningSelect: spec.returningSelect,
            filters,
            orFilters,
            userId: user.id,
            role,
            grantedMenuCodes: role ? await loadGrantedMenuCodesForUser(user.id, role) : [],
          })
        : { allowed: false as const, reason: schema ? "unknown action" : "unknown table" };

    if (!decision.allowed) {
      console.warn("[api/db/query] denied", {
        userId: user.id,
        schema: schema ?? spec?.schema ?? null,
        table: typeof table === "string" ? table : null,
        action,
        reason: decision.reason,
      });
      return forbidden();
    }

    const result = await QueryBuilder.fromSpec({
      ...spec,
      schema,
      action,
      filters: [...filters, ...decision.forcedFilters],
      orFilters,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ data: null, error: { message } }, { status: 400 });
  }
}
