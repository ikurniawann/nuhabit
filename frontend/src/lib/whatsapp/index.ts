/**
 * Titik masuk tunggal pengiriman WhatsApp.
 *
 * Penyedia dipilih lewat env `WHATSAPP_PROVIDER` (`meta` | `fonnte`). Bila
 * kosong, penyedia ditentukan otomatis dari kredensial yang tersedia — Meta
 * didahulukan karena resmi. Bila tidak ada yang terkonfigurasi, pengiriman
 * mengembalikan gagal secara rapi (bukan melempar), sehingga alur pemanggil
 * seperti OTP tetap punya jalan keluar di dev.
 */

import { sendWhatsApp as sendViaFonnte } from "@/lib/fonnte";
import { loadGatewayConfig, readGatewayConfig, sendGatewayText } from "./gateway";
import { logOutboundMessage } from "./store";
import { readMetaConfig, sendMetaTemplate, sendMetaText } from "./meta";
import type { TemplateMessage, TextMessage, WhatsAppProvider, WhatsAppResult } from "./types";

export * from "./types";
export { buildTemplatePayload, buildTextPayload, extractMetaError } from "./meta";
export { getGatewayStatus, invalidateGatewayConfigCache, loadGatewayConfig, readGatewayConfig } from "./gateway";

export function resolveProvider(): WhatsAppProvider | null {
  const explicit = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (explicit === "meta") return readMetaConfig() ? "meta" : null;
  if (explicit === "gateway") return readGatewayConfig() ? "gateway" : null;
  if (explicit === "fonnte") return process.env.FONNTE_API_KEY ? "fonnte" : null;

  // Urutan deteksi otomatis = urutan preferensi: resmi dulu, lalu gateway
  // sendiri, pihak ketiga paling akhir.
  if (readMetaConfig()) return "meta";
  if (readGatewayConfig()) return "gateway";
  if (process.env.FONNTE_API_KEY) return "fonnte";
  return null;
}

/**
 * Versi async dari resolveProvider — WAJIB dipakai jalur kirim, karena
 * konfigurasi gateway kini bisa datang dari database (loadGatewayConfig),
 * bukan hanya ENV. resolveProvider sync dipertahankan untuk pemakaian lama
 * berbasis ENV murni.
 */
async function resolveProviderAsync(): Promise<WhatsAppProvider | null> {
  const explicit = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (explicit === "meta") return readMetaConfig() ? "meta" : null;
  if (explicit === "gateway") return (await loadGatewayConfig()) ? "gateway" : null;
  if (explicit === "fonnte") return process.env.FONNTE_API_KEY ? "fonnte" : null;

  if (readMetaConfig()) return "meta";
  if (await loadGatewayConfig()) return "gateway";
  if (process.env.FONNTE_API_KEY) return "fonnte";
  return null;
}

const NOT_CONFIGURED: WhatsAppResult = {
  success: false,
  reason: "WhatsApp provider belum dikonfigurasi",
};

export interface OtpMessageOptions {
  target: string;
  code: string;
  /** Teks lengkap untuk penyedia non-template (Fonnte). */
  fallbackText: string;
}

/**
 * Kirim kode OTP. Di Meta ini WAJIB lewat template AUTHENTICATION yang sudah
 * disetujui — nama & bahasanya dari env agar bisa diganti tanpa deploy.
 */
export async function sendWhatsAppOtp(options: OtpMessageOptions): Promise<WhatsAppResult> {
  const result = await dispatchOtp(options);
  await logOutboundMessage({
    phone: options.target,
    messageType: "otp",
    body: null,
    result,
  });
  return result;
}

async function dispatchOtp(options: OtpMessageOptions): Promise<WhatsAppResult> {
  const provider = await resolveProviderAsync();
  if (!provider) return NOT_CONFIGURED;

  if (provider === "meta") {
    const config = readMetaConfig();
    if (!config) return NOT_CONFIGURED;

    const withButton = process.env.META_WA_OTP_BUTTON !== "false";
    return sendMetaTemplate(config, {
      target: options.target,
      templateName: process.env.META_WA_OTP_TEMPLATE || "otp_login",
      languageCode: process.env.META_WA_OTP_LANG || "id",
      bodyParameters: [options.code],
      copyCodeButton: withButton ? options.code : undefined,
    });
  }

  if (provider === "gateway") {
    const config = await loadGatewayConfig();
    if (!config) return NOT_CONFIGURED;
    return sendGatewayText(config, { target: options.target, message: options.fallbackText });
  }

  const result = await sendViaFonnte({ target: options.target, message: options.fallbackText });
  return { ...result, provider: "fonnte" };
}

/**
 * Kirim teks bebas (notifikasi rekrutmen, slip gaji, dsb).
 *
 * PERHATIAN: di Meta ini hanya lolos dalam jendela layanan 24 jam. Untuk pesan
 * yang diinisiasi bisnis, buat template lalu pakai `sendWhatsAppTemplate`.
 */
export interface TextMessageMeta {
  messageType?: "notification" | "chat" | "broadcast" | "system";
  sentByUserId?: string | null;
  conversationId?: string | null;
}

export async function sendWhatsAppText(
  message: TextMessage,
  meta: TextMessageMeta = {}
): Promise<WhatsAppResult> {
  const result = await dispatchText(message);
  await logOutboundMessage({
    phone: message.target,
    messageType: meta.messageType ?? "notification",
    body: message.message,
    result,
    sentByUserId: meta.sentByUserId ?? null,
    conversationId: meta.conversationId ?? null,
  });
  return result;
}

async function dispatchText(message: TextMessage): Promise<WhatsAppResult> {
  const provider = await resolveProviderAsync();
  if (!provider) return NOT_CONFIGURED;

  if (provider === "meta") {
    const config = readMetaConfig();
    if (!config) return NOT_CONFIGURED;
    return sendMetaText(config, message);
  }

  if (provider === "gateway") {
    const config = await loadGatewayConfig();
    if (!config) return NOT_CONFIGURED;
    return sendGatewayText(config, message);
  }

  const result = await sendViaFonnte(message);
  return { ...result, provider: "fonnte" };
}

/** Kirim template Meta apa pun. Tidak berlaku untuk Fonnte. */
export async function sendWhatsAppTemplate(
  message: TemplateMessage
): Promise<WhatsAppResult> {
  const config = readMetaConfig();
  if (!config) return NOT_CONFIGURED;
  return sendMetaTemplate(config, message);
}
