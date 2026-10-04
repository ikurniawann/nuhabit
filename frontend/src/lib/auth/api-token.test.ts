import { describe, expect, it } from "vitest";
import {
  accessForMethod,
  hashApiToken,
  mintApiToken,
  moduleForApiPath,
  scopeAllows,
} from "./api-token";
import { extractBearerToken, hasApiTokenPrefix } from "./api-token-format";

describe("moduleForApiPath", () => {
  it("memetakan segmen pertama path ke modul scope", () => {
    expect(moduleForApiPath("/api/pos/orders")).toBe("pos");
    expect(moduleForApiPath("/api/member-portal/orders/abc")).toBe("member");
    expect(moduleForApiPath("/api/hris/employees")).toBe("hris");
    expect(moduleForApiPath("/api/admin/api-tokens")).toBe("config");
    expect(moduleForApiPath("/api/dashboard")).toBe("reports");
    expect(moduleForApiPath("/api/sesuatu-baru")).toBe("other");
  });
});

describe("scopeAllows", () => {
  it("'*' meloloskan semua path dan method", () => {
    expect(scopeAllows(["*"], "/api/pos/orders", "POST")).toBe(true);
    expect(scopeAllows(["*"], "/api/hris/employees", "DELETE")).toBe(true);
  });

  it("write mengizinkan read+write modulnya; read hanya GET/HEAD/OPTIONS", () => {
    expect(scopeAllows(["pos:write"], "/api/pos/orders", "POST")).toBe(true);
    expect(scopeAllows(["pos:write"], "/api/pos/orders", "GET")).toBe(true);
    expect(scopeAllows(["pos:read"], "/api/pos/orders", "GET")).toBe(true);
    expect(scopeAllows(["pos:read"], "/api/pos/orders", "POST")).toBe(false);
  });

  it("modul lain tidak ikut lolos", () => {
    expect(scopeAllows(["pos:write"], "/api/hris/employees", "GET")).toBe(false);
    expect(scopeAllows([], "/api/pos/orders", "GET")).toBe(false);
  });

  it("method dipetakan read/write dengan benar", () => {
    expect(accessForMethod("get")).toBe("read");
    expect(accessForMethod("HEAD")).toBe("read");
    expect(accessForMethod("PATCH")).toBe("write");
  });
});

describe("token mint & parse", () => {
  it("mint menghasilkan prefix nh_ dan hash yang konsisten", () => {
    const minted = mintApiToken();
    expect(minted.token.startsWith("nh_")).toBe(true);
    expect(minted.token).toMatch(/^nh_[0-9a-f]{64}$/);
    expect(minted.hash).toBe(hashApiToken(minted.token));
    expect(minted.prefix).toBe(minted.token.slice(0, "nh_".length + 12));
  });

  it("extractBearerToken menerima Bearer nh_* dan token lama arkiv_*", () => {
    expect(extractBearerToken("Bearer nh_abc123")).toBe("nh_abc123");
    expect(extractBearerToken("Bearer arkiv_abc123")).toBe("arkiv_abc123");
    expect(extractBearerToken("bearer arkiv_abc123")).toBe("arkiv_abc123");
    expect(extractBearerToken("  Bearer nh_abc123  ")).toBe("nh_abc123");
    expect(extractBearerToken("Bearer lainnya")).toBeNull();
    expect(extractBearerToken("Bearer nhx_abc")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("arkiv_tanpa_bearer")).toBeNull();
  });

  it("hasApiTokenPrefix mengenali kedua prefix", () => {
    expect(hasApiTokenPrefix("nh_x")).toBe(true);
    expect(hasApiTokenPrefix("arkiv_x")).toBe(true);
    expect(hasApiTokenPrefix("bcdqr_x")).toBe(false);
  });
});
