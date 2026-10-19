import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

// proxy jadi async sejak memanggil updateSession — test lama membaca headers
// dari Promise dan gagal semua; kini di-await (perbaikan 2026-08-23).
async function call(host: string, path: string) {
  const req = new NextRequest(new URL(`https://${host}${path}`), {
    headers: { host },
  });
  const res = await proxy(req);
  const rewritten = res.headers.get("x-middleware-rewrite");
  return rewritten ? new URL(rewritten).pathname : null; // null = passed through
}

const MEMBER = "member.suluinwounderland.com";
const MEMBER_DEV = "dev.sulu.member.wit.id";
const DASH = "dashboard.suluinwounderland.com";
const DASH_DEV = "dev.sulu.wit.id";

describe("proxy: member hostname", () => {
  test("rewrites the root to /member", async () => {
    expect(await call(MEMBER, "/")).toBe("/member");
  });

  // Regression: the first version matched a "member." prefix, so the dev
  // hostname -- which carries the label in the middle -- silently fell
  // through and served the dashboard.
  test("matches the member label anywhere in the host", async () => {
    expect(await call(MEMBER_DEV, "/")).toBe("/member");
    expect(await call(MEMBER_DEV, "/coins")).toBe("/member/coins");
  });

  test("is case-insensitive", async () => {
    expect(await call("DEV.SULU.MEMBER.WIT.ID", "/")).toBe("/member");
  });

  test("prefixes a nested path", async () => {
    expect(await call(MEMBER, "/coins")).toBe("/member/coins");
  });

  // The whole portal 404s if these get prefixed: ~30 absolute calls to
  // /api/member-portal/* live in the member pages.
  test("passes /api through untouched", async () => {
    expect(await call(MEMBER, "/api/health")).toBeNull();
  });

  // Links in the app emit absolute /member/... paths; prefixing twice would
  // send them to /member/member/...
  test("does not double-prefix an already-correct path", async () => {
    expect(await call(MEMBER, "/member/coins")).toBeNull();
  });
});

describe("proxy: other hostnames", () => {
  test("leaves the dashboard host alone", async () => {
    expect(await call(DASH, "/")).toBeNull();
    expect(await call(DASH, "/member/coins")).toBeNull();
    expect(await call(DASH_DEV, "/")).toBeNull();
  });
});

describe("proxy: Go backend routes", () => {
  const request = (method: string, path: string, host = DASH) =>
    new NextRequest(new URL(`https://${host}${path}`), { method, headers: { host } });

  test("rewrites a Go route to BACKEND_URL with its query, on every host", async () => {
    vi.stubEnv("BACKEND_URL", "http://go-api:8080/");
    vi.resetModules();
    try {
      const { proxy: proxyWithGo } = await import("./proxy");
      const rewrite = async (req: NextRequest) =>
        (await proxyWithGo(req)).headers.get("x-middleware-rewrite");
      expect(await rewrite(request("GET", "/api/auth/me?x=1"))).toBe(
        "http://go-api:8080/api/auth/me?x=1",
      );
      // Same rewrite on the member host, before its /member logic.
      expect(await rewrite(request("GET", "/api/auth/me", MEMBER))).toBe(
        "http://go-api:8080/api/auth/me",
      );
      expect(
        await rewrite(request("PUT", "/api/member-portal/profile", MEMBER)),
      ).toBe("http://go-api:8080/api/member-portal/profile");
      // DELETE is not a Go route: Next answers it.
      expect(
        await rewrite(request("DELETE", "/api/member-portal/profile", MEMBER)),
      ).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  test("answers 503 for a Go route while BACKEND_URL is unset", async () => {
    vi.stubEnv("BACKEND_URL", "");
    try {
      const res = await proxy(request("GET", "/api/member-portal/me", MEMBER));
      expect(res.status).toBe(503);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(await res.json()).toMatchObject({ success: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
