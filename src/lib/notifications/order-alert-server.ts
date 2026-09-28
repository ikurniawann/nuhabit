import { randomBytes } from "crypto";
import { query } from "@/lib/db";
import { normalizeWaPhone } from "@/lib/pos/receipt-wa";
import { getSetting, getSettings, SETTING_KEYS, setSetting } from "@/lib/settings/app-settings";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import {
  buildOrderAlertMessage,
  ORDER_ALERT_SETTING_KEY,
  parseOrderAlertConfig,
  type OrderAlertConfig,
  type OrderAlertInput,
} from "./order-alert";

/**
 * Kirim notifikasi pesanan masuk ke staf. Tidak pernah melempar error ke
 * pemanggil: kegagalan kirim tidak boleh menggagalkan pesanan pelanggan.
 */

export async function loadOrderAlertConfig(): Promise<OrderAlertConfig> {
  return parseOrderAlertConfig(await getSetting(ORDER_ALERT_SETTING_KEY));
}

export async function saveOrderAlertConfig(config: OrderAlertConfig) {
  await setSetting(ORDER_ALERT_SETTING_KEY, JSON.stringify(config));
}

export type WaRecipient = { name: string; phone: string | null; role: string };

/** Karyawan aktif yang user-nya ber-role terpilih; phone null = belum diisi / tidak valid. */
export async function loadWaRecipients(roles: string[]): Promise<WaRecipient[]> {
  if (roles.length === 0) return [];
  const rows = await query<{ name: string; phone: string | null; role: string }>(
    `SELECT DISTINCT ON (e.id) e.full_name AS name, e.phone, COALESCE(r.code, u.role) AS role
     FROM hris.employees e
     JOIN configuration.users u ON u.id = e.user_id
     LEFT JOIN iam.user_roles ur ON ur.user_id = u.id
     LEFT JOIN iam.roles r ON r.id = ur.role_id
     WHERE COALESCE(e.is_active, true) = true
       AND COALESCE(u.status, 'active') = 'active'
       AND (r.code = ANY($1::text[]) OR u.role = ANY($1::text[]))
     ORDER BY e.id, e.full_name`,
    [roles]
  );
  return rows.map((row) => ({ ...row, phone: normalizeWaPhone(row.phone) }));
}

export type TelegramSubscriberStatus = "pending" | "active" | "stopped";
export type TelegramSubscriber = {
  chat_id: string;
  title: string | null;
  username: string | null;
  chat_type: string;
  status: TelegramSubscriberStatus;
  subscribed_at: string;
};

/** Semua chat (utk halaman pengaturan) atau hanya yang aktif (utk kirim). */
export async function loadTelegramSubscribers(onlyActive = true): Promise<TelegramSubscriber[]> {
  return query<TelegramSubscriber>(
    `SELECT chat_id::text AS chat_id, title, username, chat_type, status, subscribed_at
     FROM configuration.telegram_subscribers
     ${onlyActive ? "WHERE status = 'active'" : "WHERE status <> 'stopped'"}
     ORDER BY subscribed_at`
  );
}

/** /start dari Telegram: chat baru → pending; yang pernah /stop → pending lagi. */
export async function registerTelegramChat(chat: {
  id: number;
  type: string;
  title: string | null;
  username: string | null;
}): Promise<TelegramSubscriberStatus> {
  const rows = await query<{ status: TelegramSubscriberStatus }>(
    `INSERT INTO configuration.telegram_subscribers (chat_id, chat_type, title, username, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (chat_id) DO UPDATE SET
       chat_type = EXCLUDED.chat_type, title = EXCLUDED.title, username = EXCLUDED.username,
       status = CASE WHEN telegram_subscribers.status = 'active' THEN 'active' ELSE 'pending' END,
       updated_at = now()
     RETURNING status`,
    [chat.id, chat.type, chat.title, chat.username]
  );
  return rows[0]?.status ?? "pending";
}

export async function setTelegramChatStatus(chatId: string | number, status: TelegramSubscriberStatus) {
  const rows = await query<{ chat_id: string }>(
    `UPDATE configuration.telegram_subscribers SET status = $2, updated_at = now()
     WHERE chat_id = $1::bigint RETURNING chat_id::text`,
    [String(chatId), status]
  );
  return rows.length > 0;
}

export async function loadTelegramSettings() {
  const s = await getSettings([
    SETTING_KEYS.TELEGRAM_BOT_TOKEN,
    SETTING_KEYS.TELEGRAM_WEBHOOK_SECRET,
    SETTING_KEYS.TELEGRAM_BOT_USERNAME,
  ]);
  return {
    token: s[SETTING_KEYS.TELEGRAM_BOT_TOKEN]?.trim() || "",
    webhookSecret: s[SETTING_KEYS.TELEGRAM_WEBHOOK_SECRET]?.trim() || "",
    username: s[SETTING_KEYS.TELEGRAM_BOT_USERNAME]?.trim() || "",
  };
}

/** Secret acak utk path + header webhook Telegram (dibuat sekali). */
export async function ensureTelegramWebhookSecret(): Promise<string> {
  const current = (await loadTelegramSettings()).webhookSecret;
  if (current) return current;
  const secret = randomBytes(24).toString("hex");
  await setSetting(SETTING_KEYS.TELEGRAM_WEBHOOK_SECRET, secret);
  return secret;
}

export type OrderAlertResult = {
  wa: { sent: number; failed: number; skippedNoPhone: number };
  telegram: { sent: number; failed: number };
};

export async function sendStaffAlert(text: string): Promise<OrderAlertResult> {
  const config = await loadOrderAlertConfig();
  const result: OrderAlertResult = {
    wa: { sent: 0, failed: 0, skippedNoPhone: 0 },
    telegram: { sent: 0, failed: 0 },
  };

  if (config.waEnabled) {
    const [recipients, gateway] = await Promise.all([loadWaRecipients(config.waRoles), loadGatewayConfig()]);
    const phones = [...new Set(recipients.map((r) => r.phone).filter((p): p is string => Boolean(p)))];
    result.wa.skippedNoPhone = recipients.filter((r) => !r.phone).length;
    if (gateway) {
      for (const phone of phones) {
        const sent = await sendGatewayText(gateway, { target: phone, message: text });
        if (sent.success) result.wa.sent += 1;
        else result.wa.failed += 1;
      }
    } else {
      result.wa.failed += phones.length;
    }
  }

  if (config.telegramEnabled) {
    const { token } = await loadTelegramSettings();
    if (token) {
      const subscribers = await loadTelegramSubscribers();
      for (const subscriber of subscribers) {
        try {
          await sendTelegramMessage(token, subscriber.chat_id, text);
          result.telegram.sent += 1;
        } catch (error) {
          result.telegram.failed += 1;
          // Bot diblokir / dikeluarkan dari grup → berhenti mengirim ke chat itu.
          const status = (error as { status?: number }).status;
          if (status === 403) await setTelegramChatStatus(subscriber.chat_id, "stopped").catch(() => undefined);
        }
      }
    }
  }
  return result;
}

/** Pemanggil (route order) tidak menunggu; semua error ditelan & dicatat. */
export function fireOrderAlert(input: OrderAlertInput): void {
  void sendStaffAlert(buildOrderAlertMessage(input))
    .then((result) => {
      if (result.wa.failed || result.telegram.failed || result.wa.skippedNoPhone) {
        console.warn(`[order-alert] ${input.orderNumber}:`, JSON.stringify(result));
      }
    })
    .catch((error) => console.error(`[order-alert] ${input.orderNumber} gagal:`, error));
}
