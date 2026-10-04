export type PaymentGatewayProvider = "xendit" | "midtrans";
export type PaymentGatewayEnvironment = "sandbox" | "live";

export type PaymentGatewayRow = {
  id: string;
  provider: PaymentGatewayProvider;
  display_name: string;
  is_active: boolean;
  environment: PaymentGatewayEnvironment;
  secret_key: string | null;
  public_key: string | null;
  webhook_secret: string | null;
  callback_url: string | null;
  metadata: Record<string, unknown>;
  updated_at: string | null;
  created_at: string | null;
};

export type PaymentGatewayPublic = {
  id: string;
  provider: PaymentGatewayProvider;
  display_name: string;
  is_active: boolean;
  environment: PaymentGatewayEnvironment;
  secret_key_masked: string | null;
  public_key_masked: string | null;
  webhook_secret_masked: string | null;
  has_secret_key: boolean;
  has_public_key: boolean;
  has_webhook_secret: boolean;
  callback_url: string | null;
  metadata: Record<string, unknown>;
  coming_soon: boolean;
  updated_at: string | null;
};

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "********";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  const stars = "*".repeat(Math.min(8, Math.max(4, trimmed.length - 8)));
  return `${prefix}${stars}${suffix}`;
}

export function toPaymentGatewayPublic(row: PaymentGatewayRow): PaymentGatewayPublic {
  const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<
    string,
    unknown
  >;
  return {
    id: row.id,
    provider: row.provider,
    display_name: row.display_name,
    is_active: Boolean(row.is_active),
    environment: row.environment === "live" ? "live" : "sandbox",
    secret_key_masked: maskSecret(row.secret_key),
    public_key_masked: maskSecret(row.public_key),
    webhook_secret_masked: maskSecret(row.webhook_secret),
    has_secret_key: Boolean(row.secret_key && String(row.secret_key).trim()),
    has_public_key: Boolean(row.public_key && String(row.public_key).trim()),
    has_webhook_secret: Boolean(row.webhook_secret && String(row.webhook_secret).trim()),
    callback_url: row.callback_url,
    metadata,
    coming_soon: Boolean(metadata.coming_soon),
    updated_at: row.updated_at,
  };
}

/** Empty / mask placeholder means "keep existing secret". */
export function shouldKeepExistingSecret(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.includes("…") || trimmed.includes("••••") || trimmed.includes("****") || /\*{4,}/.test(trimmed)) {
    return true;
  }
  return false;
}
