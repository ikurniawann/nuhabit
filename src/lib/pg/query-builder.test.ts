import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { parseInValues, QueryBuilder } from "@/lib/pg/query-builder";

/** Fake `Pool` yang cuma menangkap SQL/params tiap query — dipakai lintas test. */
function fakePoolCapturing(captured: { sql: string; params: unknown[] }[]): Pool {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as Pool;
}

// Tes ini memakai Pool palsu, tidak menyentuh database, jadi tidak perlu
// memuat .env (dotenv juga tidak terpasang sebagai dependensi).

// Satu test di bawah adalah tes INTEGRASI: ia menembak database sungguhan lewat
// getPool(). Tanpa DATABASE_URL tes itu dilewati, bukan digagalkan — sisa
// berkas ini murni unit test dengan Pool palsu.
const hasDb = Boolean(process.env.DATABASE_URL || process.env.MIGRATE_DATABASE_URL);

describe("parseInValues", () => {
  it("splits unquoted PostgREST in-list into separate values", () => {
    expect(parseInValues("(voided,cancelled,merged,completed)")).toEqual([
      "voided",
      "cancelled",
      "merged",
      "completed",
    ]);
  });

  it("keeps quoted values and arrays", () => {
    expect(parseInValues('("completed","cancelled")')).toEqual([
      "completed",
      "cancelled",
    ]);
    expect(parseInValues(["voided", "cancelled"])).toEqual(["voided", "cancelled"]);
  });
});

describe("QueryBuilder buildReturning", () => {
  it('does not quote "*" when select mixes * with an embed (insert returning)', async () => {
    const captured: { sql: string }[] = [];
    const fakePool = {
      query: async (sql: string) => {
        captured.push({ sql });
        return { rows: [{ id: "x" }] };
      },
    } as unknown as Pool;

    const result = await new QueryBuilder("employee_salary", "public", fakePool)
      .insert({ employee_id: "e1", base_salary: 1000 })
      .select(`*, employee:employees (id, full_name)`)
      .single();

    expect(result.error).toBeNull();
    expect(captured[0].sql).toContain("RETURNING *");
    expect(captured[0].sql).not.toContain('"*"');
  });
});

describe("QueryBuilder count with pagination", () => {
  it("returns total row count, not page length, when count exact is requested with range", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const fakePool = {
      query: async (sql: string, queryParams: unknown[] = []) => {
        captured.push({ sql, params: queryParams });
        if (sql.includes("count(*)")) {
          return { rows: [{ count: 266 }] };
        }
        return { rows: Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` })) };
      },
    } as unknown as Pool;

    const result = await new QueryBuilder("v_raw_materials_stock", "public", fakePool)
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .range(0, 9);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(10);
    expect(result.count).toBe(266);
    expect(captured.some((entry) => entry.sql.includes("count(*)"))).toBe(true);
  });
});

describe("QueryBuilder .not()", () => {
  it("translates symbolic op 'eq' into a valid SQL NOT clause (not the raw 'EQ' token)", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("pos_orders", "public", fakePoolCapturing(captured))
      .select("*")
      .not("status", "eq", "cancelled");

    expect(captured[0].sql).toContain('NOT ("status" = $1)');
    expect(captured[0].sql).not.toContain("EQ");
    expect(captured[0].params).toEqual(["cancelled"]);
  });

  it.each([
    { op: "neq", value: "x", expectSql: 'NOT ("a" <> $1)' },
    { op: "gt", value: 1, expectSql: 'NOT ("a" > $1)' },
    { op: "gte", value: 1, expectSql: 'NOT ("a" >= $1)' },
    { op: "lt", value: 1, expectSql: 'NOT ("a" < $1)' },
    { op: "lte", value: 1, expectSql: 'NOT ("a" <= $1)' },
    { op: "is", value: null, expectSql: '"a" IS NOT NULL' },
  ])("translates symbolic op '$op' to a valid SQL operator", async ({ op, value, expectSql }) => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured)).select("*").not("a", op, value);

    expect(captured[0].sql).toContain(expectSql);
  });

  it("translates symbolic op 'in' via the dedicated NOT IN / buildInClause path", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured))
      .select("*")
      .not("status", "in", "(cancelled,voided)");

    expect(captured[0].sql).toContain('"status" NOT IN ($1, $2)');
  });

  it.each([
    { op: "=", value: "x", expectSql: 'NOT ("a" = $1)' },
    { op: "<>", value: "x", expectSql: 'NOT ("a" <> $1)' },
    { op: "IN", value: "(x,y)", expectSql: '"a" NOT IN' },
  ])("keeps raw SQL operator '$op' working unchanged (backward compatibility)", async ({ op, value, expectSql }) => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured)).select("*").not("a", op, value);

    expect(captured[0].sql).toContain(expectSql);
  });
});

/**
 * Regresi: node-postgres menyerialkan Array JavaScript sebagai literal array
 * Postgres, bukan JSON. Untuk kolom jsonb itu berarti [] tersimpan sebagai {}
 * dan [{...}] menghasilkan error 22P02 — inilah yang membuat pembayaran POS
 * gagal dengan "invalid input syntax for type json".
 */
describe("QueryBuilder serialisasi kolom json", () => {
  /** Pool palsu yang juga menjawab query katalog kolom json. */
  function poolWithJsonCols(
    captured: { sql: string; params: unknown[] }[],
    cols: Array<{ table_schema: string; table_name: string; column_name: string }>
  ): Pool {
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("information_schema.columns")) return { rows: cols } as never;
        captured.push({ sql, params });
        return { rows: [] } as never;
      },
    } as unknown as Pool;
  }

  const jsonCols = [
    { table_schema: "pos", table_name: "pos_order_items", column_name: "variants" },
    { table_schema: "pos", table_name: "pos_order_items", column_name: "modifiers" },
  ];

  it("mengirim kolom jsonb sebagai string JSON, bukan array Postgres", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await new QueryBuilder("pos_order_items", "pos", poolWithJsonCols(captured, jsonCols)).insert({
      product_name: "Es Kopi Susu",
      variants: [],
      modifiers: [{ id: "m1", name: "Extra Shot", price: 8000 }],
    });
    const params = captured[0].params;
    expect(params).toContain("[]");
    expect(params).toContain(JSON.stringify([{ id: "m1", name: "Extra Shot", price: 8000 }]));
    // Tidak boleh ada Array mentah yang lolos ke driver.
    expect(params.some((p) => Array.isArray(p))).toBe(false);
  });

  it("tabel tanpa skema (andalkan search_path) tetap dikenali sebagai json", async () => {
    // Ini jalur produksi yang sebenarnya: .from("pos_order_items") tanpa skema,
    // sementara tabelnya ada di skema `pos`.
    const captured: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("to_regclass")) return { rows: [{ nspname: "pos" }] } as never;
        if (sql.includes("information_schema.columns")) return { rows: jsonCols } as never;
        captured.push({ sql, params });
        return { rows: [] } as never;
      },
    } as unknown as Pool;
    await new QueryBuilder("pos_order_items", undefined, pool).insert({
      product_name: "Es Kopi Susu",
      modifiers: [{ id: "m1", name: "Extra Shot" }],
    });
    expect(captured[0].params).toContain(JSON.stringify([{ id: "m1", name: "Extra Shot" }]));
    expect(captured[0].params.some((p) => Array.isArray(p))).toBe(false);
  });

  it("kolom array asli tetap dikirim sebagai array", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await new QueryBuilder("api_tokens", "configuration", poolWithJsonCols(captured, jsonCols)).insert({
      name: "Agent",
      scopes: ["pos:read", "member:read"],
    });
    expect(captured[0].params).toContainEqual(["pos:read", "member:read"]);
  });

  it("tidak membaca katalog bila semua nilai skalar", async () => {
    const seen: string[] = [];
    const pool = {
      query: async (sql: string) => {
        seen.push(sql);
        return { rows: [] } as never;
      },
    } as unknown as Pool;
    await new QueryBuilder("pos_order_items", "pos", pool).insert({ product_name: "Es Teh", quantity: 2 });
    expect(seen.some((s) => s.includes("information_schema.columns"))).toBe(false);
  });

  it("update juga menserialkan kolom jsonb", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await new QueryBuilder("pos_order_items", "pos", poolWithJsonCols(captured, jsonCols))
      .update({ modifiers: [{ id: "m2" }] })
      .eq("id", "x");
    expect(captured[0].params).toContain(JSON.stringify([{ id: "m2" }]));
  });
});

describe("QueryBuilder embed FK hints", () => {
  it.skipIf(!hasDb)("parses PostgREST table!fk_hint syntax for self-referential joins", async () => {
    const result = await new QueryBuilder("employees")
      .select(
        `*, manager:employees!reporting_to (id, full_name, nip)`
      )
      .order("full_name", { ascending: true })
      .limit(1);

    expect(result.error).toBeNull();
    expect(Array.isArray(result.data)).toBe(true);
  });
});
