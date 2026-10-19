/**
 * Guard route HRIS karyawan dan sampul pengumuman yang masih ada di Next:
 * tanpa sesi → 401, tanpa grant menu → 403, dan database tidak disentuh.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const requireIamMenuPrefix = vi.fn();
const requireIamGuard = vi.fn();
const requireApiUser = vi.fn();
const getWorkforceActor = vi.fn();
const dbTouched = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
    requireIamGuard: (...args: unknown[]) => requireIamGuard(...args),
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
vi.mock("@/lib/db", () => ({
  query: touch,
  queryOne: touch,
  withTransaction: touch,
  getPool: touch,
}));
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: touch,
  createServerPgClient: async () => touch(),
}));

type Handler = (req: never, ctx: never) => Promise<Response>;
type RouteModule = Record<string, unknown>;

const ID = "00000000-0000-0000-0000-000000000001";
const ctx = { params: Promise.resolve({ id: ID, doc_id: ID, path: ["announcements", "a.jpg"] }) };

function req(url = "http://x/api?employee_id=" + ID, method = "GET") {
  const request = new Request(url, {
    method,
    ...(method === "GET" ? {} : { body: "{}", headers: { "Content-Type": "application/json" } }),
  }) as Request & { nextUrl: URL };
  request.nextUrl = new URL(url);
  return request as never;
}

async function call(load: () => Promise<RouteModule>, method: string): Promise<Response> {
  const handler = (await load())[method] as Handler;
  return handler(req(undefined, method), ctx as never);
}

beforeEach(async () => {
  const { ApiError } = await import("@/lib/api/auth");
  dbTouched.mockReset();
  requireIamMenuPrefix.mockReset().mockRejectedValue(ApiError.forbidden());
  requireIamGuard.mockReset().mockResolvedValue({
    error: NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 }),
    user: null,
  });
  requireApiUser.mockReset().mockRejectedValue(ApiError.unauthorized());
  getWorkforceActor.mockReset().mockResolvedValue(null);
});

const forbidden: [string, () => Promise<RouteModule>, string[]][] = [
  ["employees/[id]/contracts", () => import("@/app/api/hris/employees/[id]/contracts/route"), ["GET", "POST"]],
  [
    "employees/[id]/recruitment-documents",
    () => import("@/app/api/hris/employees/[id]/recruitment-documents/route"),
    ["GET"],
  ],
];

const unauthenticated: [string, () => Promise<RouteModule>, string[]][] = [
  ["announcements/cover/[...path]", () => import("@/app/api/hris/announcements/cover/[...path]/route"), ["GET"]],
  ["employees/[id]/lifecycle", () => import("@/app/api/hris/employees/[id]/lifecycle/route"), ["GET"]],
  ["employees/[id]/shifts", () => import("@/app/api/hris/employees/[id]/shifts/route"), ["GET", "PUT"]],
];

describe("tanpa grant menu → 403 tanpa query", () => {
  it.each(forbidden.flatMap(([name, load, methods]) => methods.map((m) => [`${m} ${name}`, load, m] as const)))(
    "%s",
    async (_name, load, method) => {
      const res = await call(load, method);
      expect(res.status).toBe(403);
      expect(dbTouched).not.toHaveBeenCalled();
    }
  );
});

describe("tanpa sesi → 401 tanpa query", () => {
  it.each(
    unauthenticated.flatMap(([name, load, methods]) => methods.map((m) => [`${m} ${name}`, load, m] as const))
  )("%s", async (_name, load, method) => {
    const res = await call(load, method);
    expect(res.status).toBe(401);
    expect(dbTouched).not.toHaveBeenCalled();
  });
});
