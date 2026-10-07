// Webhook bot Telegram: secret path + header wajib; /start → pending (butuh
// persetujuan admin), /stop → stopped, bot dikeluarkan → stopped.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const registerTelegramChat = vi.fn();
const setTelegramChatStatus = vi.fn();
const sendTelegramMessage = vi.fn();
const loadTelegramSettings = vi.fn();

vi.mock("@/lib/notifications/order-alert-server", () => ({
  loadTelegramSettings: () => loadTelegramSettings(),
  registerTelegramChat: (...args: unknown[]) => registerTelegramChat(...args),
  setTelegramChatStatus: (...args: unknown[]) => setTelegramChatStatus(...args),
}));
vi.mock("@/lib/telegram/client", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegramMessage(...args),
}));

const SECRET = "s3cr3t-webhook-token";

async function post(body: unknown, secret = SECRET, header: string | null = SECRET) {
  const { POST } = await import("./route");
  const headers = new Headers(header ? { "x-telegram-bot-api-secret-token": header } : {});
  const response = await POST({ json: async () => body, headers } as unknown as NextRequest, {
    params: Promise.resolve({ secret }),
  });
  return response.status;
}

beforeEach(() => {
  registerTelegramChat.mockReset().mockResolvedValue("pending");
  setTelegramChatStatus.mockReset().mockResolvedValue(true);
  sendTelegramMessage.mockReset().mockResolvedValue({});
  loadTelegramSettings.mockReset().mockResolvedValue({ token: "123:tok", webhookSecret: SECRET, username: "bcdcoffee_bot" });
});

const startFrom = (text: string) => ({
  message: { text, chat: { id: 555, type: "private", first_name: "Arip", username: "arip" } },
});

describe("POST /api/integrations/telegram/webhook/[secret]", () => {
  it("secret path/header salah → 401 tanpa menyentuh data", async () => {
    expect(await post(startFrom("/start"), "salah")).toBe(401);
    expect(await post(startFrom("/start"), SECRET, "salah")).toBe(401);
    expect(await post(startFrom("/start"), SECRET, null)).toBe(401);
    expect(registerTelegramChat).not.toHaveBeenCalled();
  });

  it("/start → didaftarkan pending + dibalas 'menunggu persetujuan'", async () => {
    expect(await post(startFrom("/start"))).toBe(200);
    expect(registerTelegramChat).toHaveBeenCalledWith({ id: 555, type: "private", title: "Arip", username: "arip" });
    expect(String(sendTelegramMessage.mock.calls[0][2])).toMatch(/menyetujui/);
  });

  it("/start@bot di grup juga dikenali; chat yang sudah aktif dibalas 'sudah menerima'", async () => {
    registerTelegramChat.mockResolvedValue("active");
    await post({ message: { text: "/start@bcdcoffee_bot", chat: { id: -100, type: "group", title: "Barista BCD" } } });
    expect(registerTelegramChat).toHaveBeenCalledWith({ id: -100, type: "group", title: "Barista BCD", username: null });
    expect(String(sendTelegramMessage.mock.calls[0][2])).toMatch(/sudah menerima/);
  });

  it("/stop → stopped; bot dikeluarkan dari grup → stopped", async () => {
    await post(startFrom("/stop"));
    expect(setTelegramChatStatus).toHaveBeenCalledWith(555, "stopped");
    await post({ my_chat_member: { chat: { id: -100, type: "group" }, new_chat_member: { status: "kicked" } } });
    expect(setTelegramChatStatus).toHaveBeenCalledWith(-100, "stopped");
  });

  it("pesan biasa diabaikan (tetap 200)", async () => {
    expect(await post(startFrom("halo"))).toBe(200);
    expect(registerTelegramChat).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
