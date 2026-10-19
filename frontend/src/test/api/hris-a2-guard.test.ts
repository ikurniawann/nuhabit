/**
 * Guard lampiran cuti (route HRIS yang masih dilayani Next): tanpa sesi → 401
 * dan database tidak disentuh.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiUser = vi.fn();
const getWorkforceActor = vi.fn();
const dbTouched = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireApiUser: (...args: unknown[]) => requireApiUser(...args),
  };
});
vi.mock("@/lib/hris/workforce-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hris/workforce-auth")>();
  return { ...actual, getWorkforceActor: () => getWorkforceActor() };
});

const touch = () => {
  dbTouched();
  throw new Error("database must not be reached");
};
vi.mock("@/lib/db", () => ({ query: touch, queryOne: touch, withTransaction: touch, getPool: touch }));
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: touch,
  createServerPgClient: async () => touch(),
}));

type RouteModule = Record<string, unknown>;
type Handler = (req: never, ctx: never) => Promise<Response>;

const ID = "00000000-0000-0000-0000-000000000001";
const ctx = {
  params: Promise.resolve({ id: ID, employee_id: ID, path: ["leave-attachments", ID, "a.jpg"] }),
};

function req(method: string) {
  const url = `http://x/api?employee_id=${ID}&cycle_id=${ID}&id=${ID}&resource=entry`;
  const request = new Request(url, {
    method,
    ...(method === "GET" || method === "DELETE"
      ? {}
      : { body: JSON.stringify({ action: "create-entry" }), headers: { "Content-Type": "application/json" } }),
  }) as Request & { nextUrl: URL };
  request.nextUrl = new URL(url);
  return request as never;
}

async function call(load: () => Promise<RouteModule>, method: string): Promise<Response> {
  const handler = (await load())[method] as Handler;
  return handler(req(method), ctx as never);
}

const expand = (rows: [string, () => Promise<RouteModule>, string[]][]) =>
  rows.flatMap(([name, load, methods]) => methods.map((m) => [`${m} ${name}`, load, m] as const));

beforeEach(async () => {
  const { ApiError } = await import("@/lib/api/auth");
  dbTouched.mockReset();
  requireApiUser.mockReset().mockRejectedValue(ApiError.unauthorized());
  getWorkforceActor.mockReset().mockResolvedValue(null);
});

const unauthenticated: [string, () => Promise<RouteModule>, string[]][] = [
  ["leaves/attachment/[...path]", () => import("@/app/api/hris/leaves/attachment/[...path]/route"), ["GET"]],
];

describe("tanpa sesi → 401 tanpa query", () => {
  it.each(expand(unauthenticated))("%s", async (_name, load, method) => {
    const res = await call(load, method);
    expect(res.status).toBe(401);
    expect(dbTouched).not.toHaveBeenCalled();
  });
});
