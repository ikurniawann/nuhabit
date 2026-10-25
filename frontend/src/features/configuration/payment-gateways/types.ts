import type {
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
} from "@/lib/configuration/payment-gateways";

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
  /** Midtrans merchant id; "" clears it, undefined keeps it. */
  merchant_id?: string | null;
};

export type GatewayConnectionTest = {
  provider: PaymentGatewayProvider;
  environment: PaymentGatewayEnvironment;
  message: string;
};

export type StaticQrisConfig = {
  enabled: boolean;
  imageUrl: string | null;
  available: boolean;
};
