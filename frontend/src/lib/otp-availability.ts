import { useEffect, useState } from "react";

/** Dataroom email verification stays opt-in while its flow is paused. */
export const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === "true";

export const OTP_UNAVAILABLE_MESSAGE = "Verifikasi dengan kode sedang tidak tersedia.";

/**
 * Member portal codes (self sign-up, code sign-in, code password reset) are
 * a runtime decision of the Go API, read from GET /api/member-portal/config:
 * on when a WhatsApp or email channel is configured. A build with
 * NEXT_PUBLIC_OTP_ENABLED=false keeps them off whatever the server says.
 */
export const MEMBER_OTP_FORCED_OFF = process.env.NEXT_PUBLIC_OTP_ENABLED === "false";

export type OtpChannel = "whatsapp" | "email";

/** `channel` is where codes go; null with the local dev bypass and no channel. */
export interface MemberOtpConfig {
  enabled: boolean;
  channel: OtpChannel | null;
}

const OFF: MemberOtpConfig = { enabled: false, channel: null };

/** Reads the config envelope; anything unexpected counts as off. */
export function parseMemberOtpConfig(payload: unknown, forcedOff = MEMBER_OTP_FORCED_OFF): MemberOtpConfig {
  if (forcedOff || typeof payload !== "object" || payload === null) return OFF;
  const data = (payload as { data?: { otp_enabled?: unknown; otp_channels?: unknown } }).data;
  if (data?.otp_enabled !== true) return OFF;
  const channels = Array.isArray(data.otp_channels) ? data.otp_channels : [];
  const channel = channels.find((c): c is OtpChannel => c === "whatsapp" || c === "email") ?? null;
  return { enabled: true, channel };
}

let request: Promise<MemberOtpConfig> | null = null;

/** One request per page load; a failed one is retried on the next call. */
export function fetchMemberOtpConfig(): Promise<MemberOtpConfig> {
  if (MEMBER_OTP_FORCED_OFF) return Promise.resolve(OFF);
  request ??= fetch("/api/member-portal/config", { credentials: "same-origin" })
    .then((res) => res.json())
    .then((payload) => parseMemberOtpConfig(payload))
    .catch(() => {
      request = null;
      return OFF;
    });
  return request;
}

/** The member OTP config, null while it loads. */
export function useMemberOtpConfig(): MemberOtpConfig | null {
  const [config, setConfig] = useState<MemberOtpConfig | null>(MEMBER_OTP_FORCED_OFF ? OFF : null);
  useEffect(() => {
    let live = true;
    void fetchMemberOtpConfig().then((next) => {
      if (live) setConfig(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return config;
}

/** Flows that only speak WhatsApp (table order, the public join checkout) stay off on an email-only setup. */
export function whatsappOtpOn(config: MemberOtpConfig | null): boolean {
  return config?.enabled === true && config.channel !== "email";
}
