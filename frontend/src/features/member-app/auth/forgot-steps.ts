/**
 * The forgot-password flow as pure data. With OTP off the API answers
 * front_desk for every account, so the screen skips the form entirely.
 */

export type ForgotPhase =
  | { kind: "username" }
  | { kind: "code"; username: string; phoneMasked: string }
  | { kind: "front_desk" }
  | { kind: "done" };

export type ForgotEvent =
  | { type: "otp_sent"; username: string; phoneMasked: string }
  | { type: "front_desk" }
  | { type: "reset" }
  | { type: "back" };

export function initialForgotPhase(otpEnabled: boolean): ForgotPhase {
  return otpEnabled ? { kind: "username" } : { kind: "front_desk" };
}

export function forgotTransition(phase: ForgotPhase, event: ForgotEvent): ForgotPhase {
  switch (event.type) {
    case "otp_sent":
      return { kind: "code", username: event.username, phoneMasked: event.phoneMasked };
    case "front_desk":
      return { kind: "front_desk" };
    case "reset":
      return phase.kind === "code" ? { kind: "done" } : phase;
    case "back":
      return { kind: "username" };
  }
}
