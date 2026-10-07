import { describe, expect, it } from "vitest";
import { accountTransition, initialAccountPhase, isCodeAccepted, resolveJoinStep } from "./join-steps";

describe("resolveJoinStep", () => {
  it("skips the account step when a member session exists", () => {
    expect(resolveJoinStep("present")).toBe("bayar");
    expect(resolveJoinStep("absent")).toBe("akun");
    expect(resolveJoinStep("unknown")).toBe("loading");
  });
});

describe("accountTransition", () => {
  const identity = { ticket: "t", email: "a@b.id", name: "Ayu" };

  it("asks for the code after a login OTP", () => {
    expect(accountTransition(initialAccountPhase, { type: "otp_sent", phone: "0812", devBypass: false })).toEqual({
      kind: "code",
      phone: "0812",
      devBypass: false,
    });
  });

  it("registers an unknown phone with name and email", () => {
    const phase = accountTransition(initialAccountPhase, { type: "not_registered", phone: "0812", devBypass: true });
    expect(phase).toEqual({ kind: "register", phone: "0812", devBypass: true, google: null });
    expect(accountTransition(phase, { type: "back" })).toEqual(initialAccountPhase);
  });

  it("carries the Google identity from the phone prompt into registration", () => {
    const phone = accountTransition(initialAccountPhase, { type: "google_needs_phone", identity });
    expect(phone).toEqual({ kind: "phone", google: identity });
    const register = accountTransition(phone, { type: "not_registered", phone: "0812", devBypass: false });
    expect(register).toEqual({ kind: "register", phone: "0812", devBypass: false, google: identity });
    expect(accountTransition(register, { type: "back" })).toEqual(phone);
  });

  it("falls back to a login code when the Google phone already belongs to a member", () => {
    const phone = accountTransition(initialAccountPhase, { type: "google_needs_phone", identity });
    expect(accountTransition(phone, { type: "otp_sent", phone: "0812", devBypass: false }).kind).toBe("code");
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
