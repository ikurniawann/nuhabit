import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";
import {
  handleTicketingInvoiceCallback,
  xenditCallbackSchema,
} from "@/lib/ticketing/xendit-webhook-server";
import { isValidWebhookToken } from "@/lib/xendit/client";

// Webhook invoice Xendit (PAID/EXPIRED) booking & Season Pass. Keamanan:
// verifikasi x-callback-token (401 bila salah/belum dikonfigurasi). Callback
// sah selalu di-ACK 200 (termasuk yang diabaikan); galat proses → 500
// supaya Xendit mengulang.

export const POST = apiHandler(async (request: NextRequest) => {
  // Rem volumetrik kasar per IP — longgar supaya burst retry Xendit yang
  // sah tidak pernah kena.
  assertPublicRateLimit(
    request.headers,
    "booking-webhook",
    { limit: 120, windowMs: 60_000 },
    "Too many requests"
  );
  if (!isValidWebhookToken(request.headers.get("x-callback-token"))) {
    throw ApiError.unauthorized("Unauthorized");
  }

  const parsed = xenditCallbackSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak dikenal");

  try {
    return NextResponse.json(await handleTicketingInvoiceCallback(parsed.data));
  } catch (err) {
    // Selalu 5xx (bukan 4xx dari pemetaan galat Postgres apiHandler) —
    // Xendit hanya mengulang callback yang gagal di sisi server.
    console.error("[booking] webhook error:", err);
    throw ApiError.server("Webhook gagal diproses");
  }
}, "public.booking.webhook.xendit.POST");
