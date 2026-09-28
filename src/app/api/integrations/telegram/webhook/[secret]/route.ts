import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  loadTelegramSettings,
  registerTelegramChat,
  setTelegramChatStatus,
} from "@/lib/notifications/order-alert-server";
import { sendTelegramMessage } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/telegram/webhook/[secret] — update dari bot Telegram
 * BCD Coffee (didaftarkan lewat setWebhook dari Settings → Notifikasi WA).
 * Autentikasi: secret di path + header X-Telegram-Bot-Api-Secret-Token.
 *   /start → chat didaftarkan 'pending' (menunggu persetujuan admin)
 *   /stop  → berhenti menerima notifikasi
 * Balasan selalu 200 supaya Telegram tidak mengulang update.
 */

type TelegramChat = { id: number; type: string; title?: string; username?: string; first_name?: string; last_name?: string };
type TelegramUpdate = {
  message?: { text?: string; chat?: TelegramChat };
  my_chat_member?: { chat?: TelegramChat; new_chat_member?: { status?: string } };
};

function safeEqual(expected: string, given: string | null) {
  if (!expected || !given || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function chatTitle(chat: TelegramChat) {
  return chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || null;
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const settings = await loadTelegramSettings();
  if (
    !safeEqual(settings.webhookSecret, String(secret || "")) ||
    !safeEqual(settings.webhookSecret, request.headers.get("x-telegram-bot-api-secret-token"))
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  try {
    // Bot dikeluarkan/diblokir → hentikan pengiriman ke chat itu.
    const member = update?.my_chat_member;
    if (member?.chat && ["left", "kicked"].includes(String(member.new_chat_member?.status))) {
      await setTelegramChatStatus(member.chat.id, "stopped");
      return ok();
    }

    const chat = update?.message?.chat;
    const command = String(update?.message?.text || "").trim().split(/\s+/)[0]?.split("@")[0]?.toLowerCase();
    if (!chat || !command || !settings.token) return ok();

    if (command === "/start") {
      const status = await registerTelegramChat({
        id: chat.id,
        type: chat.type,
        title: chatTitle(chat),
        username: chat.username ?? null,
      });
      await sendTelegramMessage(
        settings.token,
        chat.id,
        status === "active"
          ? "✅ Chat ini sudah menerima notifikasi pesanan masuk BCD Coffee. Ketik /stop untuk berhenti."
          : "⏳ Permintaan diterima. Admin BCD Coffee perlu menyetujui chat ini dulu (Settings → Notifikasi WA → Notifikasi pesanan masuk). Ketik /stop untuk membatalkan."
      );
    } else if (command === "/stop") {
      await setTelegramChatStatus(chat.id, "stopped");
      await sendTelegramMessage(settings.token, chat.id, "🛑 Notifikasi pesanan dihentikan. Ketik /start untuk mendaftar lagi.");
    }
  } catch (error) {
    console.error("[telegram webhook] gagal memproses update:", error);
  }
  return ok();
}
