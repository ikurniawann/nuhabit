/**
 * The /join checkout: step 1 identifies the buyer, step 2 pays. Both the
 * step and the account sub-phase are pure data so the page only renders.
 */

export type SessionState = "unknown" | "absent" | "present";
export type JoinStep = "loading" | "account" | "pay";

/** A member session lands on payment; without one the account step cannot be skipped. */
export function resolveJoinStep(session: SessionState): JoinStep {
  if (session === "unknown") return "loading";
  return session === "present" ? "pay" : "account";
}

/** A Google identity without a member: name and email are verified, the phone is still needed. */
export interface GoogleIdentity {
  ticket: string;
  email: string;
  name: string;
}

export type AccountPhase =
  /** OTP is off: members sign in with a password, new members go to the front desk. */
  | { kind: "front_desk"; googleUnlinked: boolean }
  | { kind: "phone"; google: GoogleIdentity | null }
  | { kind: "code"; phone: string; devBypass: boolean }
  | { kind: "register"; phone: string; devBypass: boolean; google: GoogleIdentity | null };

export type AccountEvent =
  | { type: "otp_sent"; phone: string; devBypass: boolean }
  | { type: "not_registered"; phone: string; devBypass: boolean }
  | { type: "google_needs_phone"; identity: GoogleIdentity }
  | { type: "back" };

export function initialAccountPhase(otpEnabled: boolean): AccountPhase {
  return otpEnabled ? { kind: "phone", google: null } : { kind: "front_desk", googleUnlinked: false };
}

export function accountTransition(phase: AccountPhase, event: AccountEvent): AccountPhase {
  if (phase.kind === "front_desk") {
    // Only Google can reach us here; an unknown Google account cannot register without OTP.
    return { kind: "front_desk", googleUnlinked: event.type === "google_needs_phone" };
  }
  const google = "google" in phase ? phase.google : null;
  switch (event.type) {
    case "otp_sent":
      return { kind: "code", phone: event.phone, devBypass: event.devBypass };
    case "not_registered":
      return { kind: "register", phone: event.phone, devBypass: event.devBypass, google };
    case "google_needs_phone":
      return { kind: "phone", google: event.identity };
    case "back":
      return { kind: "phone", google };
  }
}

/** Six digits; with the local dev bypass on, anything goes (the server checks the dev code). */
export function isCodeAccepted(code: string, devBypass: boolean): boolean {
  return devBypass || /^\d{6}$/.test(code);
}
