/**
 * Klien tipis Telegram Bot API (https://core.telegram.org/bots/api) —
 * hanya yang dipakai notifikasi pesanan: getMe, setWebhook, sendMessage.
 */

const API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 8000;

export class TelegramApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export async function telegramApi<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  fetchImpl: FetchLike = fetch
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || json.ok !== true) {
      throw new TelegramApiError(json.description || `Telegram ${method} gagal (${response.status})`, response.status);
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export function getTelegramMe(token: string, fetchImpl?: FetchLike) {
  return telegramApi<{ id: number; username?: string; first_name?: string }>(token, "getMe", {}, fetchImpl);
}

export function setTelegramWebhook(token: string, url: string, secretToken: string, fetchImpl?: FetchLike) {
  return telegramApi<boolean>(
    token,
    "setWebhook",
    { url, secret_token: secretToken, allowed_updates: ["message", "my_chat_member"], drop_pending_updates: true },
    fetchImpl
  );
}

export function sendTelegramMessage(token: string, chatId: number | string, text: string, fetchImpl?: FetchLike) {
  return telegramApi(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, fetchImpl);
}

/** Token bot berbentuk "<angka>:<35 karakter>" — validasi bentuk sebelum dipakai. */
export function isTelegramBotToken(value: string) {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(value.trim());
}
