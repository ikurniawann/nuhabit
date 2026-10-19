/**
 * Route purchasing dulu cukup sesi login (audit follow-up). Tanpa grant menu:
 * 403 sebelum database disentuh, dengan prefix IAM Items.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IAM } from "@/lib/iam/prefixes";

const requireIamMenuPrefix = vi.fn();
const dbTouched = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
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
});

const ITEMS_ROUTES: Array<[string, string]> = [["inventory/[id]/movements", "GET"]];

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
});

describe("prefix recipe-builder", () => {
  it("menerima menu POS katalog selain Items", () => {
    expect(IAM.itemsCatalog).toEqual(expect.arrayContaining([...IAM.items, ...IAM.posCatalog]));
  });
});
