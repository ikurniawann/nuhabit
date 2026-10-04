import { createHmac, timingSafeEqual } from "crypto";
import type { NormalizedInbound } from "@/lib/whatsapp/inbound";

/**
 * EPIC-013 Fase C — logika murni webhook Instagram Messaging (Meta).
 *
 * Fungsi di sini tidak menyentuh DB maupun jaringan supaya bisa diuji dengan
 * payload tiruan sebelum aplikasi Meta tersedia.
 */

/** Nama header tanda tangan Meta. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/**
 * Verifikasi `X-Hub-Signature-256` = HMAC-SHA256 dari **raw body** memakai
 * App Secret.
 *
 * Perbandingan memakai timingSafeEqual, bukan `===`, agar penyerang tidak
 * bisa menebak tanda tangan byte demi byte lewat perbedaan waktu respons.
 * Body WAJIB berupa teks mentah — mem-parse lalu men-stringify ulang JSON
 * mengubah byte-nya dan membuat tanda tangan tidak pernah cocok.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual melempar bila panjang berbeda — cek dulu, dan panjang
  // yang berbeda memang sudah pasti tidak cocok.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Hasil verifikasi langganan webhook (handshake GET dari Meta). */
export function resolveSubscribeChallenge(
  params: URLSearchParams,
  verifyToken: string
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

type IgAttachment = { type?: string };
type IgMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: IgAttachment[];
  };
};
export type IgWebhookPayload = {
  object?: string;
  entry?: { messaging?: IgMessaging[] }[];
};

/** Jenis lampiran yang dipetakan ke media_type internal. */
const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "share", "story_mention"]);

function mediaTypeOf(message: NonNullable<IgMessaging["message"]>): string | null {
  const first = message.attachments?.[0]?.type;
  if (!first) return null;
  return MEDIA_TYPES.has(first) ? first : "unknown";
}

/**
 * Ubah payload webhook menjadi daftar pesan siap simpan.
 *
 * Satu payload bisa membawa banyak entry dan banyak pesan sekaligus, jadi
 * hasilnya array. Event non-pesan (read, delivery, reaction) dan pesan
 * terhapus dilewati diam-diam — Meta tetap menganggap webhook sukses selama
 * kita membalas 200, dan menolaknya justru memicu kirim ulang tanpa henti.
 */
export function normalizeInstagramWebhook(payload: IgWebhookPayload): NormalizedInbound[] {
  if (payload?.object !== "instagram") return [];

  const result: NormalizedInbound[] = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      if (!message || message.is_deleted) continue;

      // Echo = pesan yang KITA kirim, dipantulkan balik oleh Meta. Lawan
      // bicaranya ada di recipient, bukan sender.
      const isEcho = message.is_echo === true;
      const externalId = (isEcho ? event.recipient?.id : event.sender?.id)?.trim();
      if (!externalId) continue;

      const text = typeof message.text === "string" ? message.text : null;
      const mediaType = mediaTypeOf(message);
      // Pesan tanpa teks maupun lampiran tidak membawa informasi apa pun.
      if (!text && !mediaType) continue;

      result.push({
        channel: "instagram",
        externalId,
        phone: null, // Instagram tidak punya nomor — auto-link member dilewati.
        direction: isEcho ? "out" : "in",
        body: text,
        mediaType,
        providerMessageId: message.mid ?? null,
        pushName: null, // Username diambil terpisah lewat Graph API.
        sentAt: event.timestamp ? new Date(event.timestamp) : null,
      });
    }
  }

  return result;
}

/** Batas balas standar Meta sejak pesan masuk terakhir. */
export const REPLY_WINDOW_HOURS = 24;

/**
 * Sisa waktu membalas dalam milidetik, dihitung dari pesan MASUK terakhir.
 *
 * Meta menolak pesan di luar jendela ini, jadi lebih baik agent tahu sebelum
 * menulis panjang lebar daripada balasannya gagal terkirim.
 */
export function replyWindowRemainingMs(
  lastInboundAt: Date | null,
  now: Date
): number {
  if (!lastInboundAt) return 0;
  const deadline = lastInboundAt.getTime() + REPLY_WINDOW_HOURS * 60 * 60 * 1000;
  return Math.max(0, deadline - now.getTime());
}

export function isWithinReplyWindow(lastInboundAt: Date | null, now: Date): boolean {
  return replyWindowRemainingMs(lastInboundAt, now) > 0;
}
