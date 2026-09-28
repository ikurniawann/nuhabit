"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Snapshot = {
  config: { waEnabled: boolean; waRoles: string[]; telegramEnabled: boolean };
  role_options: Array<{ code: string; label: string }>;
  wa_gateway_configured: boolean;
  wa_recipients: Array<{ name: string; role: string; phone_masked: string | null; has_phone: boolean }>;
  telegram: { connected: boolean; token_masked: string | null; username: string | null };
  telegram_chats: Array<{
    chat_id: string;
    title: string | null;
    username: string | null;
    chat_type: string;
    status: "pending" | "active" | "stopped";
  }>;
};

async function api<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/settings/order-alerts", {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: T };
  if (!response.ok || json.success === false) throw new Error(json.error || `Gagal (${response.status})`);
  return json.data as T;
}

/**
 * Notifikasi pesanan self-order ke staf: WA karyawan per role (nomor dari
 * data karyawan HRIS) + bot Telegram (chat /start, disetujui admin).
 */
export function OrderAlertSettingsCard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [form, setForm] = useState({ waEnabled: true, waRoles: ["pos"], telegramEnabled: true, token: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback((next: Snapshot) => {
    setData(next);
    setForm({
      waEnabled: next.config.waEnabled,
      waRoles: next.config.waRoles,
      telegramEnabled: next.config.telegramEnabled,
      token: "",
    });
  }, []);

  useEffect(() => {
    // Lewat timer supaya setState tidak sinkron di body effect (aturan lint React).
    const timer = window.setTimeout(() => {
      api<Snapshot>()
        .then(apply)
        .catch((error) => toast.error(error instanceof Error ? error.message : "Gagal memuat"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [apply]);

  async function run(label: string, init: RequestInit, success: string) {
    setBusy(label);
    try {
      const result = await api<Snapshot | { result: unknown }>(init);
      if ("config" in result) apply(result);
      toast.success(success);
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function save() {
    void run(
      "save",
      {
        method: "PUT",
        body: JSON.stringify({
          wa_enabled: form.waEnabled,
          wa_roles: form.waRoles,
          telegram_enabled: form.telegramEnabled,
          ...(form.token.trim() ? { telegram_bot_token: form.token.trim() } : {}),
        }),
      },
      form.token.trim() ? "Tersimpan & bot Telegram tersambung" : "Pengaturan notifikasi tersimpan"
    );
  }

  async function sendTest() {
    const result = (await run("test", { method: "POST", body: JSON.stringify({ action: "test" }) }, "Tes terkirim")) as
      | { result: { wa: { sent: number; failed: number; skippedNoPhone: number }; telegram: { sent: number; failed: number } } }
      | null;
    if (result && "result" in result) {
      const { wa, telegram } = result.result;
      toast.info(
        `WA: ${wa.sent} terkirim, ${wa.failed} gagal, ${wa.skippedNoPhone} tanpa nomor · Telegram: ${telegram.sent} terkirim, ${telegram.failed} gagal`
      );
    }
  }

  const chatAction = (action: "approve" | "remove", chatId: string) =>
    run(action + chatId, { method: "POST", body: JSON.stringify({ action, chat_id: chatId }) }, action === "approve" ? "Chat disetujui" : "Chat dihapus");

  const recipients = (data?.wa_recipients ?? []).filter((r) => form.waRoles.includes(r.role));
  const pending = (data?.telegram_chats ?? []).filter((c) => c.status === "pending");
  const active = (data?.telegram_chats ?? []).filter((c) => c.status === "active");

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <BellRing className="size-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Notifikasi pesanan masuk</h2>
          <p className="text-sm text-gray-500">
            Setiap pesanan self-order (QR meja) dikirim ke WA karyawan & chat Telegram di bawah — isi: meja, antrean,
            item + add-on, total, status bayar.
          </p>
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center py-8 text-gray-400">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <input
                type="checkbox"
                checked={form.waEnabled}
                onChange={(event) => setForm((f) => ({ ...f, waEnabled: event.target.checked }))}
                className="size-4"
              />
              WhatsApp ke karyawan
            </label>
            {!data.wa_gateway_configured ? (
              <p className="mt-1 text-xs text-amber-700">Gateway WA belum terhubung — pesan WA tidak akan terkirim.</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-700">
              {data.role_options.map((role) => (
                <label key={role.code} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.waRoles.includes(role.code)}
                    onChange={(event) =>
                      setForm((f) => ({
                        ...f,
                        waRoles: event.target.checked
                          ? [...f.waRoles, role.code]
                          : f.waRoles.filter((code) => code !== role.code),
                      }))
                    }
                    className="size-4"
                  />
                  {role.label}
                </label>
              ))}
            </div>
            <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
              {recipients.length === 0 ? (
                <li className="px-3 py-2 text-gray-500">Belum ada karyawan dengan role terpilih.</li>
              ) : (
                recipients.map((r) => (
                  <li key={`${r.name}-${r.role}`} className="flex items-center justify-between px-3 py-2">
                    <span>
                      {r.name} <span className="text-xs text-gray-400">({r.role})</span>
                    </span>
                    {r.has_phone ? (
                      <span className="font-mono text-xs text-gray-600">{r.phone_masked}</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700">No. HP belum diisi di data karyawan</span>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <input
                type="checkbox"
                checked={form.telegramEnabled}
                onChange={(event) => setForm((f) => ({ ...f, telegramEnabled: event.target.checked }))}
                className="size-4"
              />
              Telegram
            </label>
            <p className="mt-1 text-xs text-gray-500">
              {data.telegram.connected ? (
                <>
                  Bot tersambung
                  {data.telegram.username ? (
                    <>
                      :{" "}
                      <a
                        href={`https://t.me/${data.telegram.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-primary underline"
                      >
                        @{data.telegram.username}
                      </a>
                    </>
                  ) : null}
                  . Karyawan membuka bot → tekan <b>Start</b> → setujui di bawah.
                </>
              ) : (
                <>Buat bot lewat @BotFather di Telegram, lalu tempel token-nya di sini.</>
              )}
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={form.token}
              onChange={(event) => setForm((f) => ({ ...f, token: event.target.value }))}
              placeholder={data.telegram.connected ? `Tersimpan (${data.telegram.token_masked}) — isi untuk ganti` : "Token bot, mis. 123456789:AA…"}
              className="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 font-mono text-sm outline-none focus:border-primary"
            />

            {pending.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Menunggu persetujuan</div>
                <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-amber-200 bg-amber-50/40 text-sm">
                  {pending.map((chat) => (
                    <li key={chat.chat_id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span>
                        {chat.title || chat.chat_id}
                        {chat.username ? <span className="text-xs text-gray-500"> @{chat.username}</span> : null}
                        <span className="text-xs text-gray-400"> · {chat.chat_type}</span>
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" disabled={Boolean(busy)} onClick={() => chatAction("approve", chat.chat_id)} className="h-7 gap-1 px-2">
                          <Check className="size-3.5" /> Setujui
                        </Button>
                        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => chatAction("remove", chat.chat_id)} className="h-7 px-2">
                          Tolak
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
              {active.length === 0 ? (
                <li className="px-3 py-2 text-gray-500">Belum ada chat Telegram aktif.</li>
              ) : (
                active.map((chat) => (
                  <li key={chat.chat_id} className="flex items-center justify-between px-3 py-2">
                    <span>
                      {chat.title || chat.chat_id}
                      {chat.username ? <span className="text-xs text-gray-500"> @{chat.username}</span> : null}
                    </span>
                    <button
                      type="button"
                      title="Hentikan notifikasi ke chat ini"
                      disabled={Boolean(busy)}
                      onClick={() => chatAction("remove", chat.chat_id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void sendTest()} className="gap-2">
              {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Kirim tes
            </Button>
            <Button type="button" disabled={Boolean(busy)} onClick={save} className="gap-2">
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Simpan
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
