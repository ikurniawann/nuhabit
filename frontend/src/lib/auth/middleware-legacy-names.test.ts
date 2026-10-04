// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sessionTokenIsValid: vi.fn(),
  verifyApiTokenRequest: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ sessionTokenIsValid: mocks.sessionTokenIsValid }));
vi.mock("@/lib/auth/api-token", () => ({ verifyApiTokenRequest: mocks.verifyApiTokenRequest }));

import { updateSession } from "./middleware";

function request(path: string, init: { cookie?: string; authorization?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.authorization) headers.set("authorization", init.authorization);
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionTokenIsValid.mockImplementation(async (token: string) => token === "valid");
  mocks.verifyApiTokenRequest.mockResolvedValue(true);
});

describe("updateSession: cookie sesi baru dan lama", () => {
  it("menerima cookie nuhabit_session", async () => {
    const res = await updateSession(request("/api/pos/orders", { cookie: "nuhabit_session=valid" }));
    expect(res.status).toBe(200);
    expect(mocks.sessionTokenIsValid).toHaveBeenCalledWith("valid");
  });

  it("masih menerima cookie lama arkiv_session", async () => {
    const res = await updateSession(request("/api/pos/orders", { cookie: "arkiv_session=valid" }));
    expect(res.status).toBe(200);
    expect(mocks.sessionTokenIsValid).toHaveBeenCalledWith("valid");
  });

  it("cookie baru menang bila keduanya ada", async () => {
    await updateSession(request("/api/pos/orders", { cookie: "arkiv_session=lama; nuhabit_session=valid" }));
    expect(mocks.sessionTokenIsValid).toHaveBeenCalledWith("valid");
  });

  it("tanpa cookie, API ditolak 401", async () => {
    const res = await updateSession(request("/api/pos/orders"));
    expect(res.status).toBe(401);
  });
});

describe("updateSession: Bearer token nh_ dan arkiv_", () => {
  it.each(["nh_abc", "arkiv_abc"])("memverifikasi Bearer %s", async (token) => {
    const res = await updateSession(request("/api/pos/orders", { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(200);
    expect(mocks.verifyApiTokenRequest).toHaveBeenCalledWith(token, { pathname: "/api/pos/orders", method: "GET" });
  });

  it("token yang ditolak verifikasi jadi 401", async () => {
    mocks.verifyApiTokenRequest.mockResolvedValue(false);
    const res = await updateSession(request("/api/pos/orders", { authorization: "Bearer nh_dicabut" }));
    expect(res.status).toBe(401);
  });

  it("Bearer tanpa prefix dikenal tidak diverifikasi", async () => {
    const res = await updateSession(request("/api/pos/orders", { authorization: "Bearer xyz" }));
    expect(mocks.verifyApiTokenRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});
