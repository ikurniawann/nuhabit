import { createPgClient } from "@/lib/pg/create-client";
import { safeEqual } from "@/lib/security/compare";
import type { DbClient } from "@/lib/pg/types";
import type { PaymentGatewayRow } from "@/lib/configuration/payment-gateways";

/** Base URL API Xendit — bisa di-override (XENDIT_API_BASE_URL) untuk uji lokal dengan mock. */
const XENDIT_API_BASE = (process.env.XENDIT_API_BASE_URL || "https://api.xendit.co").replace(/\/$/, "");

export type XenditGatewayConfig = {
  secretKey: string;
  webhookToken: string | null;
  callbackUrl: string | null;
  environment: "sandbox" | "live";
};

export type CreateXenditQrResult = {
  id: string;
  reference_id: string;
  qr_string: string;
  status: string;
  amount: number;
  expires_at?: string | null;
  raw: Record<string, unknown>;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Xendit error";
}

export async function loadActiveXenditConfig(
  db: DbClient = createPgClient()
): Promise<XenditGatewayConfig> {
  const { data, error } = await db
    .from("payment_gateways", "configuration")
    .select("*")
    .eq("provider", "xendit")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.");
  }

  const row = data as PaymentGatewayRow;
  if (!row.is_active) {
    throw new Error("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.");
  }
  if (!row.secret_key?.trim()) {
    throw new Error("Payment gateway secret key is missing.");
  }

  return {
    secretKey: row.secret_key.trim(),
    webhookToken: row.webhook_secret?.trim() || null,
    callbackUrl: row.callback_url?.trim() || null,
    environment: row.environment === "live" ? "live" : "sandbox",
  };
}

export async function createXenditDynamicQr(input: {
  secretKey: string;
  referenceId: string;
  amount: number;
  callbackUrl?: string | null;
  description?: string;
}): Promise<CreateXenditQrResult> {
  const body: Record<string, unknown> = {
    reference_id: input.referenceId,
    type: "DYNAMIC",
    currency: "IDR",
    amount: Math.round(input.amount),
  };
  if (input.callbackUrl) body.callback_url = input.callbackUrl;
  if (input.description) body.description = input.description;

  const auth = Buffer.from(`${input.secretKey}:`).toString("base64");
  const response = await fetch(`${XENDIT_API_BASE}/qr_codes`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "api-version": "2022-07-31",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.error_code === "string" && payload.error_code) ||
      `Failed to create QRIS (${response.status})`;
    throw new Error(message);
  }

  const qrString = String(payload.qr_string || "");
  const id = String(payload.id || "");
  if (!qrString || !id) {
    throw new Error("Incomplete payment gateway response");
  }

  return {
    id,
    reference_id: String(payload.reference_id || input.referenceId),
    qr_string: qrString,
    status: String(payload.status || "ACTIVE"),
    amount: Number(payload.amount != null ? payload.amount : input.amount) || input.amount,
    expires_at: payload.expires_at ? String(payload.expires_at) : null,
    raw: payload,
  };
}

export function buildQrImageUrl(qrString: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`;
}

const PAID_QR_STATUSES = new Set(["SUCCEEDED", "SUCCESS", "COMPLETED", "PAID"]);

function paymentRowsFromPayload(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(payload.payments)) {
    return payload.payments.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
    );
  }
  if (Array.isArray(payload.data)) {
    return payload.data.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
    );
  }
  return [];
}

export function isXenditQrPaid(payload: Record<string, unknown>): boolean {
  const status = String(payload.status || "").toUpperCase();
  const paymentStatus = String(payload.payment_status || "").toUpperCase();
  if (PAID_QR_STATUSES.has(status) || PAID_QR_STATUSES.has(paymentStatus)) {
    return true;
  }
  return paymentRowsFromPayload(payload).some((row) =>
    PAID_QR_STATUSES.has(String(row.status || "").toUpperCase())
  );
}

export async function getXenditQrCode(
  secretKey: string,
  qrId: string
): Promise<Record<string, unknown> & { id: string; status?: string }> {
  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const response = await fetch(`${XENDIT_API_BASE}/qr_codes/${encodeURIComponent(qrId)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "api-version": "2022-07-31",
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      (typeof payload.message === "string" && payload.message) ||
        `Failed to fetch QRIS status (${response.status})`
    );
  }
  return { ...payload, id: String(payload.id || qrId) };
}

export async function getXenditQrCodeByReferenceId(
  secretKey: string,
  referenceId: string
): Promise<Record<string, unknown> & { id: string; qr_string?: string; amount?: number; expires_at?: string | null }> {
  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const response = await fetch(
    `${XENDIT_API_BASE}/qr_codes?reference_id=${encodeURIComponent(referenceId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "api-version": "2022-07-31",
      },
    }
  );
  const payload = (await response.json().catch(() => ({}))) as
    | Record<string, unknown>
    | Record<string, unknown>[];
  if (!response.ok) {
    const message =
      payload && !Array.isArray(payload) && typeof payload.message === "string"
        ? payload.message
        : `Failed to lookup QRIS (${response.status})`;
    throw new Error(message);
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as Record<string, unknown>[])
      : payload && typeof payload === "object" && (payload as Record<string, unknown>).id
        ? [payload as Record<string, unknown>]
        : [];
  const row = rows[0];
  const id = String(row?.id || "");
  if (!row || !id) {
    throw new Error("QRIS existing tidak ditemukan untuk checkout ini");
  }
  return { ...row, id };
}

export async function getXenditQrPayments(
  secretKey: string,
  qrId: string
): Promise<Record<string, unknown>[]> {
  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const response = await fetch(
    `${XENDIT_API_BASE}/qr_codes/${encodeURIComponent(qrId)}/payments`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "api-version": "2022-07-31",
      },
    }
  );
  const payload = (await response.json().catch(() => ({}))) as
    | Record<string, unknown>
    | Record<string, unknown>[];
  if (!response.ok) {
    const message =
      payload && !Array.isArray(payload) && typeof payload.message === "string"
        ? payload.message
        : `Failed to fetch QRIS payments (${response.status})`;
    throw new Error(message);
  }
  if (Array.isArray(payload)) return payload;
  return paymentRowsFromPayload(payload);
}

export function extractXenditWebhookToken(request: Request): string | null {
  return request.headers.get("x-callback-token");
}

/**
 * Token callback wajib cocok dengan webhook_secret gateway. Belum
 * dikonfigurasi = semua callback ditolak (fail closed); pelunasan tetap
 * berjalan lewat polling kasir / rekonsiliasi yang bertanya ke API Xendit.
 */
export function verifyXenditWebhookToken(
  incoming: string | null,
  expected: string | null
): boolean {
  return safeEqual(incoming?.trim(), expected?.trim());
}

/**
 * Cek silang nominal callback dengan catatan pending kita. Token bocor saja
 * tidak boleh cukup untuk menandai lunas; callback tanpa nominal ditolak.
 * Toleransi < 1 rupiah untuk pembulatan.
 */
export function xenditAmountMatches(expected: unknown, received: unknown): boolean {
  const want = Math.round(Number(expected));
  const got = Math.round(Number(received));
  if (!Number.isFinite(want) || !Number.isFinite(got) || want <= 0 || got <= 0) return false;
  return want === got;
}

export function parseXenditQrWebhook(body: Record<string, unknown>) {
  const data =
    body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : body;

  const status = String(data.status || body.status || "").toUpperCase();
  const qrId = String(
    data.qr_id || data.id || data.qr_code_id || body.qr_id || body.id || ""
  );
  const referenceId = String(
    data.reference_id || data.external_id || body.reference_id || body.external_id || ""
  );
  const amountRaw = data.amount != null ? data.amount : body.amount != null ? body.amount : 0;
  const amount = Number(amountRaw) || 0;
  const paymentId = String(data.payment_id || data.id || body.payment_id || "");

  const paid =
    status === "SUCCEEDED" ||
    status === "SUCCESS" ||
    status === "COMPLETED" ||
    status === "PAID" ||
    String(body.event || "").toLowerCase().includes("paid");

  return { paid, status, qrId, referenceId, amount, paymentId, data };
}

export { getErrorMessage as getXenditErrorMessage };
