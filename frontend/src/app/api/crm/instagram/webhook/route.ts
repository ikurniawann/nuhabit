// ============================================================
// API Route: Webhook Instagram Messaging (Meta)
// GET  — handshake verifikasi langganan (hub.challenge)
// POST — terima pesan masuk, verifikasi X-Hub-Signature-256
//
// Endpoint ini SENGAJA publik: Meta memanggilnya tanpa sesi. Otentikasinya
// adalah tanda tangan HMAC pada raw body, bukan cookie.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { readInstagramWebhookConfig } from "@/lib/instagram/client";
import {
  SIGNATURE_HEADER,
  normalizeInstagramWebhook,
  resolveSubscribeChallenge,
  verifySignature,
} from "@/lib/instagram/webhook";
import { recordGatewayMessage } from "@/lib/whatsapp/store";

export const GET = apiHandler(async (request: NextRequest) => {
  const config = await readInstagramWebhookConfig();
  if (!config) {
    return new NextResponse("Instagram belum dikonfigurasi", { status: 503 });
  }

  const challenge = resolveSubscribeChallenge(
    request.nextUrl.searchParams,
    config.verifyToken
  );

  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Meta menuntut challenge dikembalikan apa adanya sebagai teks biasa.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}, "crm.instagram.webhook.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const config = await readInstagramWebhookConfig();
  if (!config) {
    return new NextResponse("Instagram belum dikonfigurasi", { status: 503 });
  }

  // Raw body wajib — mem-parse lalu men-stringify ulang mengubah byte-nya
  // sehingga tanda tangan tidak akan pernah cocok.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get(SIGNATURE_HEADER), config.appSecret)) {
    return new NextResponse("Signature tidak valid", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Body cacat tidak akan membaik bila dikirim ulang.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const messages = normalizeInstagramWebhook(payload as never);

  let stored = 0;
  for (const message of messages) {
    try {
      const result = await recordGatewayMessage(message);
      if (result.stored) stored += 1;
    } catch (error) {
      // Satu pesan gagal tidak boleh menggagalkan seluruh batch: Meta akan
      // mengirim ULANG seluruh payload, sehingga pesan yang sudah tersimpan
      // ikut diproses lagi. Dicatat lalu lanjut.
      console.error("Gagal menyimpan pesan Instagram:", error);
    }
  }

  // Selalu 200 selama tanda tangan sah. Status non-2xx membuat Meta mengirim
  // ulang berkali-kali dan akhirnya menonaktifkan langganan webhook.
  return NextResponse.json({ received: true, stored }, { status: 200 });
}, "crm.instagram.webhook.POST");
