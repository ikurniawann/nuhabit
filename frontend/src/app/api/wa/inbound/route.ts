import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeInbound, type GatewayInboundPayload } from "@/lib/whatsapp/inbound";
import { recordGatewayMessage } from "@/lib/whatsapp/store";
import { onInboundMessage } from "@/lib/crm/cs-server";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * EPIC-012 Fase B — penerima event pesan dari wa-gateway (Baileys
 * messages.upsert). Auth = token bersama WA_GATEWAY_TOKEN (dua arah).
 *
 * PENTING: app ini terjangkau dari internet lewat cloudflared, jadi endpoint
 * ini TIDAK boleh dianggap lokal-saja. Pengerasan (hasil review):
 * - perbandingan token constant-time,
 * - backoff global untuk percobaan token gagal (anti brute-force),
 * - batas ukuran body & jumlah pesan per batch.
 */

const MAX_BODY_BYTES = 512 * 1024;
const MAX_BATCH = 200;

// Anti brute-force token: setelah N kegagalan dalam jendela, tolak 429 dulu.
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60_000;
let authFailures: number[] = [];

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const token = process.env.WA_GATEWAY_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  authFailures = authFailures.filter((at) => at > now - AUTH_FAIL_WINDOW_MS);
  if (authFailures.length >= AUTH_FAIL_LIMIT) {
    return NextResponse.json({ success: false, error: "Too many attempts" }, { status: 429 });
  }

  if (!tokenMatches(request.headers.get("x-gateway-token"), token)) {
    authFailures.push(now);
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let payloads: GatewayInboundPayload[];
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Payload terlalu besar" },
        { status: 413 }
      );
    }
    const json = JSON.parse(raw);
    payloads = Array.isArray(json?.messages) ? json.messages.slice(0, MAX_BATCH) : [];
  } catch {
    return NextResponse.json({ success: false, error: "JSON tidak valid" }, { status: 400 });
  }

  let stored = 0;
  let skipped = 0;

  for (const payload of payloads) {
    const normalized = normalizeInbound(payload);
    if (!normalized) {
      skipped += 1;
      continue;
    }

    try {
      const result = await recordGatewayMessage(normalized);
      if (!result.stored) {
        skipped += 1;
        continue;
      }
      stored += 1;

      // Aturan CS (Fase D) hanya berlaku utk pesan dari customer, bukan
      // balasan manual dari HP bisnis (direction out).
      if (normalized.direction === "in" && result.conversationId) {
        const cs = await onInboundMessage(
          result.conversationId,
          normalized.body,
          normalized.sentAt ?? new Date()
        );
        // Auto-reply saat ini baru untuk WhatsApp; kanal lain menyusul di
        // Fase C bersama pengirimnya masing-masing.
        if (cs.autoReplyText && normalized.channel === "whatsapp" && normalized.phone) {
          await sendWhatsAppText(
            { target: normalized.phone, message: cs.autoReplyText },
            { messageType: "system", conversationId: result.conversationId }
          );
        }
      }
    } catch (error) {
      // Satu pesan gagal tidak boleh menggagalkan sisanya; gateway tidak
      // mengulang batch yang sudah dijawab 200.
      console.error(
        "[wa-inbound] Gagal merekam pesan:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return NextResponse.json({ success: true, stored, skipped });
}
