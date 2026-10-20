import { describe, expect, it } from "vitest";
import { parseMemberOtpConfig, whatsappOtpOn } from "./otp-availability";

const envelope = (otp_enabled: unknown, otp_channels: unknown) => ({ success: true, data: { otp_enabled, otp_channels } });

describe("member OTP config", () => {
  it("follows the server answer", () => {
    expect(parseMemberOtpConfig(envelope(true, ["whatsapp", "email"]), false)).toEqual({ enabled: true, channel: "whatsapp" });
    expect(parseMemberOtpConfig(envelope(true, ["email"]), false)).toEqual({ enabled: true, channel: "email" });
    expect(parseMemberOtpConfig(envelope(true, []), false)).toEqual({ enabled: true, channel: null });
    expect(parseMemberOtpConfig(envelope(false, ["whatsapp"]), false)).toEqual({ enabled: false, channel: null });
  });

  it("treats a broken answer as off", () => {
    expect(parseMemberOtpConfig(null, false).enabled).toBe(false);
    expect(parseMemberOtpConfig({ success: false, error: "x" }, false).enabled).toBe(false);
    expect(parseMemberOtpConfig(envelope("true", ["whatsapp"]), false).enabled).toBe(false);
  });

  it("stays off when the build forces it off", () => {
    expect(parseMemberOtpConfig(envelope(true, ["whatsapp"]), true)).toEqual({ enabled: false, channel: null });
  });

  it("keeps WhatsApp-only flows off on an email-only setup", () => {
    expect(whatsappOtpOn({ enabled: true, channel: "whatsapp" })).toBe(true);
    expect(whatsappOtpOn({ enabled: true, channel: null })).toBe(true);
    expect(whatsappOtpOn({ enabled: true, channel: "email" })).toBe(false);
    expect(whatsappOtpOn({ enabled: false, channel: null })).toBe(false);
    expect(whatsappOtpOn(null)).toBe(false);
  });
});
