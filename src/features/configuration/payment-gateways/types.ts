export type {
  PaymentGatewayProvider,
  PaymentGatewayEnvironment,
  PaymentGatewayPublic,
} from "@/lib/configuration/payment-gateways";

export type UpdatePaymentGatewayPayload = {
  provider: "xendit" | "midtrans";
  display_name?: string;
  is_active: boolean;
  environment: "sandbox" | "live";
  secret_key?: string | null;
  public_key?: string | null;
  webhook_secret?: string | null;
  callback_url?: string | null;
};

export type StaticQrisConfig = {
  enabled: boolean;
  imageUrl: string | null;
  available: boolean;
};
