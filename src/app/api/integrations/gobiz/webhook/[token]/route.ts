import { NextRequest, NextResponse } from "next/server";
import { loadGobizConfig } from "@/lib/gobiz/config";
import { parseGofoodWebhook } from "@/lib/gobiz/mapping";
import { processGofoodEvent, recordGofoodEvent } from "@/lib/gobiz/service";
import { verifyGobizSignature } from "@/lib/gobiz/signature";
import { safeEqual } from "@/lib/security/compare";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/gobiz/webhook/[token] — penerima event GoBiz (EPIC-049).
 *
 * Autentikasi: token acak di path (dibuat di Settings → Integrasi → GoBiz dan
 * didaftarkan ke GoBiz lewat notification-subscriptions) + header
 * X-Go-Signature = HMAC-SHA256 hex raw body dgn Relay secret. Begitu Relay
 * secret diisi, tanda tangan WAJIB valid (401 bila salah/absen); tanpa secret
 * hanya token path yang menjaga. Header
 * X-Go-Idempotency-Key + event_id disimpan utk idempotency (GoBiz tidak
 * menjamin exactly-once). Balasan selalu {success:true} agar GoBiz tidak
 * retry berulang utk event yang memang kita abaikan.
 */

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const config = await loadGobizConfig();
  if (!safeEqual(config.webhookToken, token)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Raw body dibaca sekali: dipakai utk HMAC tanda tangan lalu di-parse.
  const rawBody = await request.text().catch(() => "");
  const signature = verifyGobizSignature(rawBody, request.headers.get("x-go-signature"), config.relaySecret);
  if (signature !== "valid" && signature !== "unconfigured") {
    console.warn(`[gobiz webhook] X-Go-Signature ${signature}, event ditolak`);
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown = null;
  try {
    json = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    json = null;
  }
  const event = parseGofoodWebhook(json);
  if (!event) {
    console.warn("[gobiz webhook] payload tidak dikenali:", JSON.stringify(json).slice(0, 500));
    return NextResponse.json({ success: true, data: {}, ignored: true, reason: "unrecognized_payload" });
  }

  const idempotencyKey = request.headers.get("x-go-idempotency-key");
  try {
    const eventRowId = await recordGofoodEvent(event, idempotencyKey);
    if (!eventRowId) {
      return NextResponse.json({ success: true, data: {}, ignored: true, reason: "duplicate_event" });
    }
    const result = await processGofoodEvent(event, eventRowId);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    // Event sudah tercatat (result=error) → bisa diproses ulang dari halaman GoFood.
    console.error(`[gobiz webhook] ${event.header.event_name} ${event.header.event_id} gagal:`, error);
    return NextResponse.json({ success: true, data: {}, processed: false });
  }
}
