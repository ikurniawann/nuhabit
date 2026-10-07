/**
 * WhatsApp Business Cloud API (Meta) — penyedia resmi.
 *
 * Catatan penting soal aturan Meta yang membentuk kode di bawah:
 * - Pesan yang diinisiasi bisnis (OTP, notifikasi) HARUS berupa template yang
 *   sudah disetujui. Teks bebas ditolak di luar jendela 24 jam.
 * - Template OTP harus berkategori AUTHENTICATION dan wajib menyertakan tombol
 *   salin-kode; parameter tombol berisi kode yang sama dengan badan pesan.
 */

import type { TemplateMessage, TextMessage, WhatsAppResult } from "./types";

const DEFAULT_GRAPH_VERSION = "v21.0";

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
}

export function readMetaConfig(): MetaConfig | null {
  const accessToken = process.env.META_WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return null;

  return {
    accessToken,
    phoneNumberId,
    graphVersion: process.env.META_WA_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
  };
}

export function metaEndpoint(config: MetaConfig): string {
  return `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
}

/** Payload template — dipisah agar bisa diuji tanpa menyentuh jaringan. */
export function buildTemplatePayload(message: TemplateMessage): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (message.bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: message.bodyParameters.map((text) => ({ type: "text", text })),
    });
  }

  if (message.copyCodeButton) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: message.copyCodeButton }],
    });
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: message.target,
    type: "template",
    template: {
      name: message.templateName,
      language: { code: message.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

export function buildTextPayload(message: TextMessage): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: message.target,
    type: "text",
    text: { preview_url: false, body: message.message },
  };
}

/** Ambil pesan error Graph API tanpa ikut membawa isi pesan yang dikirim. */
export function extractMetaError(data: unknown): string {
  const error = (data as { error?: { message?: string; code?: number; error_subcode?: number } })
    ?.error;
  if (!error) return "Unknown error";

  const parts = [error.message ?? "Unknown error"];
  if (error.code != null) parts.push(`code ${error.code}`);
  if (error.error_subcode != null) parts.push(`subcode ${error.error_subcode}`);
  return parts.join(" · ");
}

async function postToMeta(
  config: MetaConfig,
  payload: Record<string, unknown>
): Promise<WhatsAppResult> {
  try {
    const response = await fetch(metaEndpoint(config), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { success: false, provider: "meta", reason: extractMetaError(data) };
    }

    const messageId = (data as { messages?: { id?: string }[] })?.messages?.[0]?.id;
    return { success: true, provider: "meta", messageId };
  } catch (error) {
    return {
      success: false,
      provider: "meta",
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendMetaTemplate(
  config: MetaConfig,
  message: TemplateMessage
): Promise<WhatsAppResult> {
  return postToMeta(config, buildTemplatePayload(message));
}

/**
 * Teks bebas — HANYA berhasil bila penerima membalas dalam 24 jam terakhir.
 * Di luar itu Meta menolak; pakai template.
 */
export async function sendMetaText(
  config: MetaConfig,
  message: TextMessage
): Promise<WhatsAppResult> {
  return postToMeta(config, buildTextPayload(message));
}
