import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { loadGobizConfig } from "@/lib/gobiz/config";
import { parseGofoodWebhook } from "@/lib/gobiz/mapping";
import { processGofoodEvent, recordGofoodEvent } from "@/lib/gobiz/service";
import { verifyGobizSignature } from "@/lib/gobiz/signature";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/gobiz/webhook/[token] — penerima event GoBiz (EPIC-049).
 *
 * Autentikasi: token acak di path (dibuat di Settings → Integrasi → GoBiz dan
 * didaftarkan ke GoBiz lewat notification-subscriptions) + header
 * X-Go-Signature = HMAC-SHA256 hex raw body dgn Relay secret. Tanda tangan
 * ditegakkan (401) hanya bila "gobiz_signature_enforce" = true; selain itu
 * hasilnya dicatat saja sampai terbukti cocok di sandbox. Header
 * X-Go-Idempotency-Key + event_id disimpan utk idempotency (GoBiz tidak
 * menjamin exactly-once). Balasan selalu {success:true} agar GoBiz tidak
 * retry berulang utk event yang memang kita abaikan.
 */

function tokenMatches(expected: string, given: string) {
  if (!expected || !given || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const config = await loadGobizConfig();
  if (!tokenMatches(config.webhookToken, String(token || ""))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Raw body dibaca sekali: dipakai utk HMAC tanda tangan lalu di-parse.
  const rawBody = await request.text().catch(() => "");
  const signature = verifyGobizSignature(rawBody, request.headers.get("x-go-signature"), config.relaySecret);
  if (signature !== "valid" && signature !== "unconfigured") {
    if (config.enforceSignature) {
      return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }
    console.warn(`[gobiz webhook] X-Go-Signature ${signature} (mode pantau, event tetap diproses)`);
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
    if (signature === "valid") console.info(`[gobiz webhook] X-Go-Signature valid (${event.header.event_name})`);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    // Event sudah tercatat (result=error) → bisa diproses ulang dari halaman GoFood.
    console.error(`[gobiz webhook] ${event.header.event_name} ${event.header.event_id} gagal:`, error);
    return NextResponse.json({ success: true, data: {}, processed: false });
  }
}
