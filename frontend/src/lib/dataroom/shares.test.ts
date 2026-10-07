import { describe, expect, it } from "vitest";
import {
  generateShareToken, hashEmailCode, isEmailAllowed, isShareActive, pendingSteps,
  sessionCookieName, SHARE_TOKEN_RE,
} from "./shares";

describe("dataroom share helpers", () => {
  it("token acak lolos pola & nama cookie", () => {
    const t = generateShareToken();
    expect(SHARE_TOKEN_RE.test(t)).toBe(true);
    expect(sessionCookieName(t)).toBe(`drs_${t}`);
  });

  it("isEmailAllowed case-insensitive", () => {
    expect(isEmailAllowed(["Budi@Wit.id"], "budi@wit.id ")).toBe(true);
    expect(isEmailAllowed(["budi@wit.id"], "lain@wit.id")).toBe(false);
    expect(isEmailAllowed([], "")).toBe(false);
  });

  it("isShareActive: dicabut atau kedaluwarsa -> tidak aktif", () => {
    const now = new Date("2026-09-04T10:00:00Z");
    expect(isShareActive({ revoked_at: null, expires_at: "2026-09-05T00:00:00Z" }, now)).toBe(true);
    expect(isShareActive({ revoked_at: "2026-09-04T09:00:00Z", expires_at: "2026-09-05T00:00:00Z" }, now)).toBe(false);
    expect(isShareActive({ revoked_at: null, expires_at: "2026-09-04T09:59:59Z" }, now)).toBe(false);
  });

  it("pendingSteps mengikuti jenis link, PIN, dan progres sesi", () => {
    expect(pendingSteps({ access_type: "public", pin_hash: null }, null)).toEqual({ needEmail: false, needPin: false });
    expect(pendingSteps({ access_type: "email", pin_hash: "h" }, null)).toEqual({ needEmail: true, needPin: true });
    expect(pendingSteps({ access_type: "email", pin_hash: "h" }, { email_ok: true, pin_ok: false })).toEqual({ needEmail: false, needPin: true });
    expect(pendingSteps({ access_type: "public", pin_hash: "h" }, { email_ok: false, pin_ok: true })).toEqual({ needEmail: false, needPin: false });
  });

  it("hashEmailCode deterministik & peka share/email/kode", () => {
    const a = hashEmailCode("s1", "A@x.com", "123456");
    expect(a).toBe(hashEmailCode("s1", "a@x.com", "123456"));
    expect(a).not.toBe(hashEmailCode("s2", "a@x.com", "123456"));
    expect(a).not.toBe(hashEmailCode("s1", "a@x.com", "654321"));
  });
});
