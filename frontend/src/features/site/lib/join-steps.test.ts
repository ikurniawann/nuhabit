import { describe, expect, it } from "vitest";
import { accountTransition, initialAccountPhase, isCodeAccepted, resolveJoinStep } from "./join-steps";

const start = initialAccountPhase(true);

describe("resolveJoinStep", () => {
  it("skips the account step when a member session exists", () => {
    expect(resolveJoinStep("present")).toBe("pay");
    expect(resolveJoinStep("absent")).toBe("account");
    expect(resolveJoinStep("unknown")).toBe("loading");
  });
});

describe("accountTransition", () => {
  const identity = { ticket: "t", email: "a@b.id", name: "Ayu" };

  it("asks for the code after a login OTP", () => {
    expect(accountTransition(start, { type: "otp_sent", phone: "0812", devBypass: false })).toEqual({
      kind: "code",
      phone: "0812",
      devBypass: false,
    });
  });

  it("registers an unknown phone with name and email", () => {
    const phase = accountTransition(start, { type: "not_registered", phone: "0812", devBypass: true });
    expect(phase).toEqual({ kind: "register", phone: "0812", devBypass: true, google: null });
    expect(accountTransition(phase, { type: "back" })).toEqual(start);
  });

  it("carries the Google identity from the phone prompt into registration", () => {
    const phone = accountTransition(start, { type: "google_needs_phone", identity });
    expect(phone).toEqual({ kind: "phone", google: identity });
    const register = accountTransition(phone, { type: "not_registered", phone: "0812", devBypass: false });
    expect(register).toEqual({ kind: "register", phone: "0812", devBypass: false, google: identity });
    expect(accountTransition(register, { type: "back" })).toEqual(phone);
  });

  it("falls back to a login code when the Google phone already belongs to a member", () => {
    const phone = accountTransition(start, { type: "google_needs_phone", identity });
    expect(accountTransition(phone, { type: "otp_sent", phone: "0812", devBypass: false }).kind).toBe("code");
  });

  it("stays at the front desk when OTP is off", () => {
    const frontDesk = initialAccountPhase(false);
    expect(frontDesk).toEqual({ kind: "front_desk", googleUnlinked: false });
    const unlinked = accountTransition(frontDesk, { type: "google_needs_phone", identity });
    expect(unlinked).toEqual({ kind: "front_desk", googleUnlinked: true });
    expect(accountTransition(unlinked, { type: "back" })).toEqual(frontDesk);
    expect(accountTransition(frontDesk, { type: "otp_sent", phone: "0812", devBypass: false })).toEqual(frontDesk);
  });
});

describe("isCodeAccepted", () => {
  it("wants six digits unless the dev bypass is on", () => {
    expect(isCodeAccepted("123456", false)).toBe(true);
    expect(isCodeAccepted("12345", false)).toBe(false);
    expect(isCodeAccepted("dev-local", false)).toBe(false);
    expect(isCodeAccepted("", true)).toBe(true);
    expect(isCodeAccepted("dev-local", true)).toBe(true);
  });
});
