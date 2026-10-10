import { describe, expect, it } from "vitest";
import { forgotTransition, initialForgotPhase } from "./forgot-steps";

describe("forgot password steps", () => {
  it("starts at the front desk message when OTP is off", () => {
    expect(initialForgotPhase(false)).toEqual({ kind: "front_desk" });
    expect(initialForgotPhase(true)).toEqual({ kind: "username" });
  });

  it("asks for the code and new password after the OTP is sent", () => {
    const code = forgotTransition(initialForgotPhase(true), {
      type: "otp_sent",
      username: "081234567890",
      phoneMasked: "0812****890",
    });
    expect(code).toEqual({ kind: "code", username: "081234567890", phoneMasked: "0812****890" });
    expect(forgotTransition(code, { type: "reset" })).toEqual({ kind: "done" });
    expect(forgotTransition(code, { type: "back" })).toEqual({ kind: "username" });
  });

  it("shows the front desk message when the API says so", () => {
    expect(forgotTransition(initialForgotPhase(true), { type: "front_desk" })).toEqual({ kind: "front_desk" });
  });

  it("ignores a reset outside the code step", () => {
    expect(forgotTransition({ kind: "username" }, { type: "reset" })).toEqual({ kind: "username" });
  });
});
