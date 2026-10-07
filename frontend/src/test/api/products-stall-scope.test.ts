/**
 * Regresi: daftar Produk harus ikut stall aktif di sidebar, tapi param
 * `warehouse_id` eksplisit (mis. picker POS) tetap menang.
 */
import { describe, expect, it, vi } from "vitest";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const STALL_A = "11111111-1111-4111-8111-111111111111";
const STALL_B = "22222222-2222-4222-8222-222222222222";

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

function makeRecordingBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const result = { data: [], count: 0, error: null };
  for (const method of [
    "select", "is", "or", "eq", "in", "order", "range", "limit", "not", "gt", "gte", "lte",
  ]) {
    builder[method] = (...args: unknown[]) => {
      recorded.push(`${table}.${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return builder;
    };
  }
  builder.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result));
  return builder;
}

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => makeRecordingBuilder(table),
  })),
}));

async function queryTraceFor(stallId: string | null, qs = ""): Promise<string> {
  activeStallId = stallId;
  recorded = [];
  vi.resetModules();
  const { GET } = await import("@/app/api/purchasing/products/route");
  const res = await GET(
    new Request(`http://localhost/api/purchasing/products?page=1&limit=10${qs}`) as never
  );
  expect(res.status).toBe(200);
  return recorded.join("\n");
}

describe("GET /api/purchasing/products — scope stall aktif", () => {
  it("memfilter produk ke stall aktif", async () => {
    expect(await queryTraceFor(STALL_A)).toContain(`eq("warehouse_id","${STALL_A}")`);
  });

  it("param warehouse_id eksplisit menang atas stall aktif", async () => {
    const trace = await queryTraceFor(STALL_A, `&warehouse_id=${STALL_B}`);
    expect(trace).toContain(`eq("warehouse_id","${STALL_B}")`);
    expect(trace).not.toContain(STALL_A);
  });

  it('mode "Semua Stall" tidak memfilter warehouse', async () => {
    expect(await queryTraceFor(null)).not.toContain("warehouse_id");
  });
});
