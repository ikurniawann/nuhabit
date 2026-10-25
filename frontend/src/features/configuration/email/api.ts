import { apiGet, apiPost, apiPut, buildListUrl } from "@/lib/api-client";

/** Settings → Integrasi → Email: provider, pengirim, kirim uji, log keluar. */

export type EmailProvider = "" | "resend" | "microsoft";
export type EmailTransport = "" | "graph" | "smtp";
export type EmailResolved = "" | "resend" | "microsoft-graph" | "microsoft-smtp";

export interface EmailSettings {
  provider: EmailProvider;
  transport: EmailTransport;
  from_email: string;
  from_name: string;
  resend_api_key_masked: string | null;
  has_resend_api_key: boolean;
  ms_tenant_id: string;
  ms_client_id: string;
  ms_client_secret_masked: string | null;
  has_ms_client_secret: boolean;
  ms_sender: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password_masked: string | null;
  has_smtp_password: boolean;
  resolved: EmailResolved;
  configured: boolean;
  /** Kunci setting yang nilainya datang dari env server. */
  from_env: string[];
}

/** Draf form. Rahasia kosong = biarkan nilai tersimpan; null = hapus. */
export interface EmailDraft {
  provider: EmailProvider;
  transport: EmailTransport;
  from_email: string;
  from_name: string;
  resend_api_key: string | null;
  ms_tenant_id: string;
  ms_client_id: string;
  ms_client_secret: string | null;
  ms_sender: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string | null;
}

export type EmailUpdatePayload = Partial<{
  provider: EmailProvider;
  transport: EmailTransport;
  from_email: string;
  from_name: string;
  resend_api_key: string | null;
  ms_tenant_id: string;
  ms_client_id: string;
  ms_client_secret: string | null;
  ms_sender: string;
  smtp_host: string;
  smtp_port: number | null;
  smtp_user: string;
  smtp_password: string | null;
}>;

export const draftFrom = (s: EmailSettings): EmailDraft => ({
  provider: s.provider,
  transport: s.transport,
  from_email: s.from_email,
  from_name: s.from_name,
  resend_api_key: "",
  ms_tenant_id: s.ms_tenant_id,
  ms_client_id: s.ms_client_id,
  ms_client_secret: "",
  ms_sender: s.ms_sender,
  smtp_host: s.smtp_host,
  smtp_port: s.smtp_port ? String(s.smtp_port) : "",
  smtp_user: s.smtp_user,
  smtp_password: "",
});

const SECRET_FIELDS = ["resend_api_key", "ms_client_secret", "smtp_password"] as const;

/**
 * Payload PUT dari draf: field biasa selalu dikirim (kosong = hapus), rahasia
 * hanya kalau diketik (string berisi) atau dihapus (null); kosong = tidak
 * disentuh dan nilai tersimpan dipertahankan.
 */
export function buildEmailPayload(draft: EmailDraft): EmailUpdatePayload {
  const port = draft.smtp_port.trim();
  const payload: EmailUpdatePayload = {
    provider: draft.provider,
    transport: draft.transport,
    from_email: draft.from_email.trim(),
    from_name: draft.from_name.trim(),
    ms_tenant_id: draft.ms_tenant_id.trim(),
    ms_client_id: draft.ms_client_id.trim(),
    ms_sender: draft.ms_sender.trim(),
    smtp_host: draft.smtp_host.trim(),
    smtp_port: port === "" ? null : Number(port),
    smtp_user: draft.smtp_user.trim(),
  };
  for (const field of SECRET_FIELDS) {
    const value = draft[field];
    if (value === null) payload[field] = null;
    else if (value.trim() !== "") payload[field] = value.trim();
  }
  return payload;
}

export interface EmailLogEntry {
  id: string;
  kind: string;
  to: string;
  from: string;
  subject: string;
  provider: string;
  status: "queued" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  error: string | null;
  message_id: string | null;
  sent_at: string | null;
  created_at: string | null;
}

export interface EmailLog {
  entries: EmailLogEntry[];
  summary: { sent: number; queued: number; failed: number };
}

export interface EmailLogFilter {
  status?: "" | "sent" | "queued" | "failed";
  q?: string;
  limit?: number;
}

export interface EmailTestResult {
  to: string;
  provider: string;
  message_id: string;
  log_id: string;
}

const ENDPOINT = "/api/settings/email";

export const fetchEmailSettings = () =>
  apiGet<{ data: EmailSettings }>(ENDPOINT).then((r) => r.data);

export const saveEmailSettings = (payload: EmailUpdatePayload) =>
  apiPut<{ data: EmailSettings }>(ENDPOINT, payload).then((r) => r.data);

export const sendTestEmail = () =>
  apiPost<{ data: EmailTestResult }>(`${ENDPOINT}/test`, {}).then((r) => r.data);

export const fetchEmailLog = (filter: EmailLogFilter) =>
  apiGet<{ data: EmailLog }>(buildListUrl(`${ENDPOINT}/log`, { ...filter })).then((r) => r.data);

export const resendEmail = (id: string) =>
  apiPost<{ data: { status: string; message_id: string } }>(`${ENDPOINT}/log/${id}/resend`, {}).then((r) => r.data);

export const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  "microsoft-graph": "Microsoft Graph",
  "microsoft-smtp": "Microsoft SMTP",
};

export const providerLabel = (resolved: string) => PROVIDER_LABELS[resolved] ?? resolved;
