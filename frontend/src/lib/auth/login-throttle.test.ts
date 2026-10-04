import { describe, expect, it } from "vitest";
import {
  LOGIN_MAX_PER_ACCOUNT,
  LOGIN_MAX_PER_IP,
  exceedsLimit,
  normalizeAccountKey,
  shouldBlockLogin,
} from "@/lib/auth/login-throttle";

describe("normalizeAccountKey", () => {
  it("huruf kecil + trim supaya A@x.com dan a@x.com satu hitungan", () => {
    expect(normalizeAccountKey("  Admin@Bcdcoffee.ID ")).toBe("admin@bcdcoffee.id");
    expect(normalizeAccountKey(null)).toBe("");
  });
  it("dibatasi panjangnya (email raksasa tidak membebani indeks)", () => {
    expect(normalizeAccountKey("a".repeat(500))).toHaveLength(254);
  });
});

describe("shouldBlockLogin", () => {
  it("batas per-akun ketat", () => {
    expect(shouldBlockLogin({ accountCount: LOGIN_MAX_PER_ACCOUNT - 1, ipCount: 0 })).toBe(false);
    expect(shouldBlockLogin({ accountCount: LOGIN_MAX_PER_ACCOUNT, ipCount: 0 })).toBe(true);
  });
  it("batas per-IP jauh lebih longgar (banyak kasir di balik satu NAT)", () => {
    expect(LOGIN_MAX_PER_IP).toBeGreaterThan(LOGIN_MAX_PER_ACCOUNT * 5);
    expect(shouldBlockLogin({ accountCount: 0, ipCount: LOGIN_MAX_PER_IP - 1 })).toBe(false);
    expect(shouldBlockLogin({ accountCount: 0, ipCount: LOGIN_MAX_PER_IP })).toBe(true);
  });
  it("exceedsLimit inklusif pada batas", () => {
    expect(exceedsLimit(7, 8)).toBe(false);
    expect(exceedsLimit(8, 8)).toBe(true);
  });
});
