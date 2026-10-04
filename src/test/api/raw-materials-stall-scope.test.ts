/**
 * Regresi: "ganti stall di Data Master Bahan Baku, data tidak berubah".
 *
 * Sebelum perbaikan, GET /api/purchasing/raw-materials membangun query yang
 * identik untuk stall manapun karena tidak pernah membaca stall aktif.
 */
import { describe, expect, it, vi } from "vitest";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const STALL_A = "11111111-1111-4111-8111-111111111111";
const STALL_B = "22222222-2222-4222-8222-222222222222";

/** null = mode "Semua Stall" */
let activeStallId: string | null = null;
let recorded: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  getUser: vi.fn(async () => ({
    user: { id: "u1", role: "super_admin", active_stall_id: activeStallId },
    db: null,
  })),
}));

vi.mock("@/lib/db", () => ({
  queryOne: vi.fn(async () => ({
    role: "super_admin",
    business_scope: null,
    holding_id: null,
    company_id: null,
    branch_id: null,
  })),
  query: vi.fn(async () => []),
  getPool: vi.fn(),
}));

/** Query builder yang merekam setiap panggilan supaya dua run bisa dibandingkan. */
function makeRecordingBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const result = { data: [], count: 0, error: null };
  for (const method of [
    "select", "is", "or", "eq", "in", "order", "range", "limit", "not", "gte", "lte",
  ]) {
    builder[method] = (...args: unknown[]) => {
      recorded.push(`${table}.${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return builder;
    };
  }
  // Route meng-await `summaryBase` dan hasil `range()`.
  builder.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result));
  return builder;
}

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => makeRecordingBuilder(table),
  })),
}));

/** Jalankan GET dengan stall aktif tertentu, kembalikan jejak query-nya. */
async function queryTraceFor(stallId: string | null): Promise<string> {
  activeStallId = stallId;
  recorded = [];
  vi.resetModules();
  const { GET } = await import("@/app/api/purchasing/raw-materials/route");
  const res = await GET(
    new Request("http://localhost/api/purchasing/raw-materials?page=1&limit=10") as never
  );
  expect(res.status).toBe(200);
  return recorded.join("\n");
}

describe("GET /api/purchasing/raw-materials — scope stall aktif", () => {
  it("membangun query berbeda untuk stall yang berbeda", async () => {
    const forStallA = await queryTraceFor(STALL_A);
    const forStallB = await queryTraceFor(STALL_B);

    expect(forStallA).not.toBe(forStallB);
  });

  it("memfilter daftar dan kartu ringkasan ke stall aktif", async () => {
    const trace = await queryTraceFor(STALL_A);

    // Daftar dan summary sama-sama dibatasi, agar KPI tidak beda dari tabel.
    const filters = trace
      .split("\n")
      .filter((line) => line.includes(`eq("warehouse_id","${STALL_A}")`));
    expect(filters).toHaveLength(2);
    expect(trace).toContain("v_raw_materials_stock_by_warehouse");
  });

  it('mode "Semua Stall" tetap memakai view agregat tanpa filter warehouse', async () => {
    const trace = await queryTraceFor(null);

    expect(trace).not.toContain("warehouse_id");
    expect(trace).not.toContain("v_raw_materials_stock_by_warehouse");
    expect(trace).toContain("v_raw_materials_stock.");
  });
});
