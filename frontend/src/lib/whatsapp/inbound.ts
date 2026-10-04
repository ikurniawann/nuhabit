/**
 * Normalisasi event pesan dari gateway (Baileys `messages.upsert`) menjadi
 * bentuk datar yang siap disimpan. Fungsi murni — logika di sini diuji unit
 * tanpa DB/jaringan.
 */

export interface GatewayInboundPayload {
  /** JID pengirim/tujuan, mis. "628xxx@s.whatsapp.net". */
  remoteJid?: string;
  fromMe?: boolean;
  messageId?: string;
  timestamp?: number;
  /** Teks hasil ekstraksi gateway; null bila non-teks. */
  text?: string | null;
  /** Jenis media bila pesan bukan teks murni. */
  mediaType?: string | null;
  pushName?: string | null;
}

export interface NormalizedInbound {
  /** Kanal asal; default whatsapp agar pemanggil lama tidak berubah. */
  channel: "whatsapp" | "instagram";
  /** Identitas pengirim di kanalnya (digit nomor / IGSID). */
  externalId: string;
  /** Nomor telepon — hanya terisi untuk WhatsApp. */
  phone: string | null;
  direction: "in" | "out";
  body: string | null;
  mediaType: string | null;
  providerMessageId: string | null;
  pushName: string | null;
  /** Waktu pesan menurut WhatsApp (bukan waktu diterima server). */
  sentAt: Date | null;
}

const MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
]);

/** JID grup/status/newsletter bukan percakapan CS — dilewati. */
export function isDirectChatJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  return jid.endsWith("@s.whatsapp.net");
}

export function jidToPhone(jid: string): string | null {
  const digits = jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/**
 * Validasi + normalisasi payload gateway. Mengembalikan null bila payload
 * bukan pesan chat personal yang layak disimpan.
 */
export function normalizeInbound(payload: GatewayInboundPayload): NormalizedInbound | null {
  if (!isDirectChatJid(payload.remoteJid)) return null;

  const phone = jidToPhone(payload.remoteJid!);
  if (!phone) return null;

  const rawText = typeof payload.text === "string" ? payload.text.trim() : "";
  const mediaType =
    payload.mediaType && MEDIA_TYPES.has(payload.mediaType) ? payload.mediaType : null;

  // Tanpa teks dan tanpa media yang dikenal (reaksi, protokol, dsb.) — abaikan.
  if (!rawText && !mediaType) return null;

  const timestamp = Number(payload.timestamp);
  const sentAt =
    Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;

  return {
    channel: "whatsapp",
    externalId: phone,
    phone,
    direction: payload.fromMe ? "out" : "in",
    // Body dibatasi agar satu pesan raksasa tidak membengkakkan tabel.
    body: rawText ? rawText.slice(0, 4000) : null,
    mediaType,
    providerMessageId:
      typeof payload.messageId === "string" && payload.messageId ? payload.messageId : null,
    pushName: payload.pushName?.trim() || null,
  sentAt,
  };
}

/** Preview singkat untuk daftar percakapan. */
export function messagePreview(body: string | null, mediaType: string | null): string {
  if (body) return body.length > 80 ? `${body.slice(0, 77)}...` : body;
  if (mediaType) return `[${mediaType}]`;
  return "";
}
