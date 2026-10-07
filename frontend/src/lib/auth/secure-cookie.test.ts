import { describe, expect, it } from "vitest";
import { isSecureRequest } from "./secure-cookie";

function req(headers: Record<string, string>) {
  return new Request("http://internal.invalid/whatever", { headers });
}

describe("isSecureRequest", () => {
  it("menghormati X-Forwarded-Proto dari proxy", () => {
    expect(isSecureRequest(req({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(isSecureRequest(req({ "x-forwarded-proto": "http", host: "10.20.89.5" }))).toBe(false);
  });

  it("memakai nilai pertama saat proxy berlapis", () => {
    expect(isSecureRequest(req({ "x-forwarded-proto": "https,http" }))).toBe(true);
    expect(
      isSecureRequest(req({ "x-forwarded-proto": "http, https", host: "10.20.89.5" }))
    ).toBe(false);
  });

  it("tidak peduli huruf besar/kecil", () => {
    expect(isSecureRequest(req({ "x-forwarded-proto": "HTTPS" }))).toBe(true);
  });

  it("akses langsung lewat IP LAN dianggap HTTP polos", () => {
    expect(isSecureRequest(req({ host: "10.20.89.5:3004" }))).toBe(false);
  });

  it("akses langsung lewat IP tailscale dianggap HTTP polos", () => {
    expect(isSecureRequest(req({ host: "100.107.60.3:3004" }))).toBe(false);
  });

  it("localhost dan IPv6 literal dianggap HTTP polos", () => {
    expect(isSecureRequest(req({ host: "localhost:3000" }))).toBe(false);
    expect(isSecureRequest(req({ host: "[fd7a:115c::1]:3004" }))).toBe(false);
  });

  it("nama domain tanpa header proxy tetap dianggap HTTPS", () => {
    // Tidak ada 80/443 terbuka di server; domain hanya terjangkau lewat tunnel.
    expect(isSecureRequest(req({ host: "dashboard.suluinwounderland.com" }))).toBe(true);
    expect(isSecureRequest(req({ host: "member.suluinwounderland.com" }))).toBe(true);
  });

  it("XFP https menang; XFP http tidak menurunkan host domain", () => {
    expect(
      isSecureRequest(req({ host: "10.20.89.5:3004", "x-forwarded-proto": "https" }))
    ).toBe(true);
    // Next.js menyuntikkan XFP "http" sendiri saat tidak ada proxy, jadi nilai
    // itu tidak boleh menurunkan host domain yang jelas lewat tunnel TLS.
    expect(
      isSecureRequest(
        req({ host: "dashboard.suluinwounderland.com", "x-forwarded-proto": "http" })
      )
    ).toBe(true);
  });

  it("host kosong tidak melempar error", () => {
    expect(isSecureRequest(req({}))).toBe(true);
  });
});
