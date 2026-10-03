import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isTimestampFresh,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "@/lib/crm/partners";
import { findPartnerByCode, ingestPartnerEvent } from "@/lib/crm/partners-server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

const eventSchema = z.object({
  external_id: z.string().trim().min(1).max(200),
  event_type: z.string().trim().min(1).max(80),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const unauthorized = () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

/**
 * POST /api/integrations/loyalty-events/[partner] — event dari partner
 * loyalty (photobooth, studio game, dll.).
 *
 * Header wajib:
 *   X-Timestamp: detik Unix, maksimal selisih 5 menit dari jam server
 *   X-Signature: sha256=<hex HMAC-SHA256(raw body, secret partner)>
 * Idempoten per `external_id`: kirim ulang tidak memberi XP dua kali.
 */
export async function POST(request: Request, { params }: { params: Promise<{ partner: string }> }) {
  const { partner: code } = await params;
  const rawBody = await request.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "Payload terlalu besar" }, { status: 413 });
  }

  const partner = await findPartnerByCode(code);
  // Partner nonaktif atau tanpa secret tidak bisa mengirim apa pun.
  if (!partner || !partner.is_active) return unauthorized();
  if (!isTimestampFresh(request.headers.get(TIMESTAMP_HEADER), new Date())) return unauthorized();
  if (!verifySignature(rawBody, request.headers.get(SIGNATURE_HEADER), partner.signing_secret)) {
    return unauthorized();
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Body bukan JSON" }, { status: 400 });
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Data event tidak valid" }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const { event, duplicate } = await ingestPartnerEvent(partner, {
      externalId: body.external_id,
      eventType: body.event_type,
      subject: body.email || body.phone || body.subject || null,
      occurredAt: body.occurred_at ?? null,
      payload: body.payload ?? {},
    });
    return NextResponse.json({
      success: true,
      data: { id: event.id, status: event.status, xp_awarded: event.xp_awarded, duplicate },
    });
  } catch (error) {
    console.error("[loyalty-events] ingest error:", error);
    return NextResponse.json({ success: false, error: "Gagal memproses event" }, { status: 500 });
  }
}
