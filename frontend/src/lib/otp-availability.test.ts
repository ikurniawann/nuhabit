import { describe, expect, it } from "vitest";
import { parseMemberOtpConfig, whatsappOtpOn } from "./otp-availability";

const envelope = (otp_enabled: unknown, otp_channels: unknown, referral_active = false) => ({
  success: true,
  data: { otp_enabled, otp_channels, referral_active },
});
const off = { enabled: false, channel: null, referralActive: false };

describe("member OTP config", () => {
  it("follows the server answer", () => {
    expect(parseMemberOtpConfig(envelope(true, ["whatsapp", "email"]), false)).toEqual({ enabled: true, channel: "whatsapp", referralActive: false });
    expect(parseMemberOtpConfig(envelope(true, ["email"], true), false)).toEqual({ enabled: true, channel: "email", referralActive: true });
    expect(parseMemberOtpConfig(envelope(true, []), false)).toEqual({ enabled: true, channel: null, referralActive: false });
    expect(parseMemberOtpConfig(envelope(false, ["whatsapp"]), false)).toEqual(off);
  });

  it("treats a broken answer as off", () => {
    expect(parseMemberOtpConfig(null, false).enabled).toBe(false);
    expect(parseMemberOtpConfig({ success: false, error: "x" }, false).enabled).toBe(false);
    expect(parseMemberOtpConfig(envelope("true", ["whatsapp"]), false).enabled).toBe(false);
  });

  it("stays off when the build forces it off, keeping the referral flag", () => {
    expect(parseMemberOtpConfig(envelope(true, ["whatsapp"]), true)).toEqual(off);
    expect(parseMemberOtpConfig(envelope(true, ["whatsapp"], true), true)).toEqual({ ...off, referralActive: true });
  });

  it("keeps WhatsApp-only flows off on an email-only setup", () => {
    expect(whatsappOtpOn({ ...off, enabled: true, channel: "whatsapp" })).toBe(true);
    expect(whatsappOtpOn({ ...off, enabled: true })).toBe(true);
    expect(whatsappOtpOn({ ...off, enabled: true, channel: "email" })).toBe(false);
    expect(whatsappOtpOn(off)).toBe(false);
    expect(whatsappOtpOn(null)).toBe(false);
  });
});
