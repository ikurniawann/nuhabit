import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { toPaymentGatewayPublic, type PaymentGatewayRow } from "@/lib/configuration/payment-gateways";
import { updatePaymentGateway } from "@/lib/settings/payment-gateways";

const updateSchema = z.object({
  provider: z.enum(["xendit", "midtrans"]),
  display_name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean(),
  environment: z.enum(["sandbox", "live"]),
  secret_key: z.string().optional().nullable(),
  public_key: z.string().optional().nullable(),
  webhook_secret: z.string().optional().nullable(),
  callback_url: z.string().trim().max(500).optional().nullable(),
});

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  const db = await createServerPgClient();
  const { data, error } = await db
    .from("payment_gateways", "configuration")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return NextResponse.json({ success: true, data: ((data ?? []) as PaymentGatewayRow[]).map(toPaymentGatewayPublic) });
}, "GET /api/settings/payment-gateways");

export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  const body = await validateBody(request, updateSchema);
  const data = await updatePaymentGateway(user.id, body);
  return NextResponse.json({ success: true, data, message: "Payment gateway settings saved" });
}, "PUT /api/settings/payment-gateways");
