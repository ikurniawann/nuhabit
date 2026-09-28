import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { ORDER_ALERT_ROLE_OPTIONS } from "@/lib/notifications/order-alert";
import {
  ensureTelegramWebhookSecret,
  loadOrderAlertConfig,
  loadTelegramSettings,
  loadTelegramSubscribers,
  loadWaRecipients,
  saveOrderAlertConfig,
  sendStaffAlert,
  setTelegramChatStatus,
} from "@/lib/notifications/order-alert-server";
import { maskSecret, SETTING_KEYS, setSetting } from "@/lib/settings/app-settings";
import {
  getTelegramMe,
  isTelegramBotToken,
  sendTelegramMessage,
  setTelegramWebhook,
  TelegramApiError,
} from "@/lib/telegram/client";
import { loadGatewayConfig } from "@/lib/whatsapp/gateway";

/**
 * Notifikasi pesanan masuk (Settings → Notifikasi WA).
 * GET  : konfigurasi, penerima WA (nomor disamarkan), status bot & chat Telegram.
 * PUT  : { wa_enabled, wa_roles, telegram_enabled, telegram_bot_token? }
 * POST : { action: approve|remove (chat_id) | test | reconnect }
 */
export const dynamic = "force-dynamic";

function appUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin).replace(/\/$/, "");
}

function maskPhone(phone: string | null) {
  return phone ? `${phone.slice(0, 4)}••••${phone.slice(-3)}` : null;
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function handleError(error: unknown, label: string) {
  if (error instanceof ApiError) return error.toResponse();
  if (error instanceof TelegramApiError) return fail(`Telegram: ${error.message}`, 502);
  console.error(`[settings/order-alerts] ${label} gagal:`, error);
  return fail("Gagal memproses notifikasi pesanan", 500);
}

async function snapshot() {
  const [config, telegram, gateway] = await Promise.all([
    loadOrderAlertConfig(),
    loadTelegramSettings(),
    loadGatewayConfig(),
  ]);
  const [recipients, chats] = await Promise.all([
    loadWaRecipients(ORDER_ALERT_ROLE_OPTIONS.map((role) => role.code)),
    loadTelegramSubscribers(false),
  ]);
  return {
    config,
    role_options: ORDER_ALERT_ROLE_OPTIONS,
    wa_gateway_configured: Boolean(gateway),
    wa_recipients: recipients.map((r) => ({ name: r.name, role: r.role, phone_masked: maskPhone(r.phone), has_phone: Boolean(r.phone) })),
    telegram: {
      connected: Boolean(telegram.token),
      token_masked: maskSecret(telegram.token || null),
      username: telegram.username || null,
    },
    telegram_chats: chats,
  };
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    return NextResponse.json({ success: true, data: await snapshot() });
  } catch (error) {
    return handleError(error, "GET");
  }
}

const putSchema = z.object({
  wa_enabled: z.boolean(),
  wa_roles: z.array(z.enum(ORDER_ALERT_ROLE_OPTIONS.map((role) => role.code) as [string, ...string[]])).max(5),
  telegram_enabled: z.boolean(),
  telegram_bot_token: z.string().trim().max(100).optional(),
});

async function connectTelegram(request: NextRequest, token: string) {
  const me = await getTelegramMe(token);
  const secret = await ensureTelegramWebhookSecret();
  await setTelegramWebhook(token, `${appUrl(request)}/api/integrations/telegram/webhook/${secret}`, secret);
  await setSetting(SETTING_KEYS.TELEGRAM_BOT_TOKEN, token);
  await setSetting(SETTING_KEYS.TELEGRAM_BOT_USERNAME, me.username ?? "");
}

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Data tidak valid", 400);
    const body = parsed.data;
    if (body.telegram_bot_token) {
      if (!isTelegramBotToken(body.telegram_bot_token)) return fail("Format token bot Telegram tidak valid", 400);
      await connectTelegram(request, body.telegram_bot_token);
    }
    await saveOrderAlertConfig({
      waEnabled: body.wa_enabled,
      waRoles: body.wa_roles,
      telegramEnabled: body.telegram_enabled,
    });
    return NextResponse.json({ success: true, data: await snapshot() });
  } catch (error) {
    return handleError(error, "PUT");
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), chat_id: z.string().regex(/^-?\d{1,20}$/) }),
  z.object({ action: z.literal("remove"), chat_id: z.string().regex(/^-?\d{1,20}$/) }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("reconnect") }),
]);

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Aksi tidak valid", 400);
    const body = parsed.data;
    const telegram = await loadTelegramSettings();

    if (body.action === "approve" || body.action === "remove") {
      const changed = await setTelegramChatStatus(body.chat_id, body.action === "approve" ? "active" : "stopped");
      if (!changed) return fail("Chat tidak ditemukan", 404);
      if (body.action === "approve" && telegram.token) {
        await sendTelegramMessage(
          telegram.token,
          body.chat_id,
          "✅ Disetujui. Chat ini sekarang menerima notifikasi pesanan masuk BCD Coffee. Ketik /stop untuk berhenti."
        ).catch(() => undefined);
      }
      return NextResponse.json({ success: true, data: await snapshot() });
    }

    if (body.action === "reconnect") {
      if (!telegram.token) return fail("Token bot Telegram belum diisi", 400);
      await connectTelegram(request, telegram.token);
      return NextResponse.json({ success: true, data: await snapshot() });
    }

    const result = await sendStaffAlert(
      "🧪 Tes notifikasi pesanan masuk BCD Coffee.\nKalau pesan ini sampai, notifikasi pesanan baru akan dikirim ke sini."
    );
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    return handleError(error, "POST");
  }
}
