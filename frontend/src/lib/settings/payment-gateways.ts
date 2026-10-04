import { ApiError } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  shouldKeepExistingSecret,
  toPaymentGatewayPublic,
  type PaymentGatewayRow,
} from "@/lib/configuration/payment-gateways";

export interface PaymentGatewayUpdate {
  provider: "xendit" | "midtrans";
  display_name?: string;
  is_active: boolean;
  environment: "sandbox" | "live";
  secret_key?: string | null;
  public_key?: string | null;
  webhook_secret?: string | null;
  callback_url?: string | null;
}

const SECRET_FIELDS = ["secret_key", "public_key", "webhook_secret"] as const;

/**
 * Kolom yang ditulis untuk update gateway. Rahasia kosong/tersamar = pakai
 * nilai lama; gateway "coming soon" tidak bisa diaktifkan; aktif wajib punya
 * secret key (baru atau tersimpan).
 */
export function buildPaymentGatewayPatch(current: PaymentGatewayRow, body: PaymentGatewayUpdate, userId: string) {
  const metadata = (current.metadata && typeof current.metadata === "object" ? current.metadata : {}) as Record<
    string,
    unknown
  >;
  if (metadata.coming_soon && body.is_active) {
    throw ApiError.badRequest(`${current.display_name} belum tersedia (coming soon)`);
  }

  const patch: Record<string, unknown> = {
    is_active: body.is_active,
    environment: body.environment,
    callback_url: body.callback_url?.trim() || null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (body.display_name) patch.display_name = body.display_name;
  for (const field of SECRET_FIELDS) {
    if (!shouldKeepExistingSecret(body[field])) patch[field] = String(body[field]).trim();
  }
  if (body.is_active && !patch.secret_key && !current.secret_key) {
    throw ApiError.badRequest("Secret key wajib diisi sebelum mengaktifkan gateway");
  }
  return patch;
}

export async function updatePaymentGateway(userId: string, body: PaymentGatewayUpdate) {
  const db = await createServerPgClient();
  const { data: existing, error: existingError } = await db
    .from("payment_gateways", "configuration")
    .select("*")
    .eq("provider", body.provider)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw ApiError.notFound(`Provider ${body.provider} belum terdaftar`);

  const { data, error } = await db
    .from("payment_gateways", "configuration")
    .update(buildPaymentGatewayPatch(existing as PaymentGatewayRow, body, userId))
    .eq("provider", body.provider)
    .select("*")
    .single();
  if (error) throw error;
  return toPaymentGatewayPublic(data as PaymentGatewayRow);
}
