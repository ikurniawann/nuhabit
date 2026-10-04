/**
 * Route purchasing dulu cukup sesi login (audit follow-up). Tanpa grant menu:
 * 403 sebelum database disentuh, dengan prefix IAM yang dipakai halaman
 * pemanggilnya (Items, atau Items + POS katalog untuk recipe-builder).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IAM } from "@/lib/iam/prefixes";

const requireIamMenuPrefix = vi.fn();
const requireIamAction = vi.fn();
const dbTouched = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
    requireIamAction: (...args: unknown[]) => requireIamAction(...args),
  };
});

const touch = () => {
  dbTouched();
  throw new Error("database must not be reached");
};
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: touch,
  createServerPgClient: async () => touch(),
}));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: async () => touch(),
}));

const req = (body: unknown = {}) =>
  new Request("http://x/api/purchasing", { method: "POST", body: JSON.stringify(body) }) as never;
const id = "00000000-0000-0000-0000-000000000001";
const params = { params: Promise.resolve({ id, produk_id: id, termId: id, item_id: id, lookup: "categories" }) };

type Handler = (...args: never[]) => Promise<Response>;
const route = (path: string) => import(`@/app/api/purchasing/${path}/route`) as Promise<Record<string, Handler>>;

beforeEach(async () => {
  const { ApiError } = await import("@/lib/api/auth");
  dbTouched.mockReset();
  requireIamMenuPrefix.mockReset().mockRejectedValue(ApiError.forbidden());
  requireIamAction.mockReset().mockRejectedValue(ApiError.forbidden());
});

const ITEMS_ROUTES: Array<[string, string]> = [
  ["dashboard", "GET"],
  ["po", "GET"],
  ["po", "POST"],
  ["po/form-data", "GET"],
  ["po/[id]", "GET"],
  ["po/[id]", "PUT"],
  ["po/[id]", "DELETE"],
  ["po/[id]/items", "POST"],
  ["po/[id]/payment-terms", "POST"],
  ["po/[id]/payment-terms/[termId]", "DELETE"],
  ["po/items/[item_id]", "PUT"],
  ["products", "POST"],
  ["products/[id]", "PUT"],
  ["products/[id]", "DELETE"],
  ["products/[id]/apply-recipe-hpp", "POST"],
  ["raw-materials", "POST"],
  ["raw-materials/[id]", "DELETE"],
  ["raw-materials/[id]/bom", "POST"],
  ["raw-materials/[id]/price-history", "GET"],
  ["raw-materials/[id]/purchase-price", "GET"],
  ["raw-material-bom/[id]", "PUT"],
  ["inventory", "GET"],
  ["inventory/[id]", "GET"],
  ["inventory/[id]/movements", "GET"],
  ["inventory/movements", "GET"],
  ["inventory/supply", "GET"],
  ["inventory/supply/form-data", "GET"],
  ["inventory/supply/[id]", "GET"],
  ["returns", "GET"],
  ["returns", "POST"],
  ["returns/[id]", "PATCH"],
  ["returns/grn-options", "GET"],
  ["deliveries", "POST"],
  ["deliveries/[id]", "DELETE"],
  ["grn/[id]/items", "POST"],
  ["grn/[id]/returnable-items", "GET"],
  ["units", "POST"],
  ["units/[id]", "DELETE"],
  ["import/units", "POST"],
  ["items/[lookup]", "POST"],
  ["items/[lookup]/[id]", "DELETE"],
  ["supply-items", "POST"],
  ["supply-items/[id]", "PATCH"],
  ["suppliers/[id]/price-history", "GET"],
  ["receiving-workspace", "GET"],
  ["reports/inventory-valuation", "GET"],
  ["vendor-payments", "GET"],
  ["cogs/product/[produk_id]", "GET"],
  ["cogs/raw-material/[id]", "GET"],
  ["pr", "GET"],
  ["pr/for-po", "GET"],
  ["pr/[id]", "GET"],
  ["pr/[id]", "PUT"],
  ["pr/[id]/submit", "POST"],
  ["pr/[id]/revise", "POST"],
];

// Dipanggil POS recipe-builder & picker produk POS (menu pos.catalog).
const CATALOG_ROUTES: Array<[string, string]> = [
  ["products", "GET"],
  ["raw-materials", "GET"],
  ["products/[id]/bom", "GET"],
  ["products/[id]/bom", "POST"],
  ["bom/[id]", "PUT"],
  ["bom/[id]", "DELETE"],
];

async function call(path: string, method: string) {
  const handler = (await route(path))[method];
  return (handler as (...args: unknown[]) => Promise<Response>)(req(), params);
}

describe("tanpa grant → 403 tanpa query", () => {
  it.each(ITEMS_ROUTES)("%s %s pakai IAM.items", async (path, method) => {
    const res = await call(path, method);
    expect(res.status).toBe(403);
    expect(requireIamMenuPrefix).toHaveBeenCalledWith(IAM.items);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it.each(CATALOG_ROUTES)("%s %s pakai IAM.itemsCatalog", async (path, method) => {
    const res = await call(path, method);
    expect(res.status).toBe(403);
    expect(requireIamMenuPrefix).toHaveBeenCalledWith(IAM.itemsCatalog);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it.each([
    ["pr", "POST", IAM.itemsPr, "create"],
    ["pr/form-data", "GET", IAM.itemsPr, "create"],
    ["pr/[id]/approve", "POST", IAM.itemsPrApproval, "update"],
  ] as const)("%s %s pakai grant action", async (path, method, prefixes, action) => {
    const res = await call(path, method);
    expect(res.status).toBe(403);
    expect(requireIamAction).toHaveBeenCalledWith(prefixes, action);
    expect(dbTouched).not.toHaveBeenCalled();
  });
});

describe("prefix recipe-builder", () => {
  it("menerima menu POS katalog selain Items", () => {
    expect(IAM.itemsCatalog).toEqual(expect.arrayContaining([...IAM.items, ...IAM.posCatalog]));
  });
});
