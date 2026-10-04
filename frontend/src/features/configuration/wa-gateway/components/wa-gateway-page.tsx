"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/format";
import {
  fetchGatewayState,
  saveGatewayConfig,
  type GatewayState,
} from "../api";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  History,
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { WaMessageHistory } from "./wa-message-history";

/**
 * Settings → WhatsApp Gateway — status koneksi + QR pairing.
 *
 * QR pairing berganti ±20 detik di sisi WhatsApp, jadi halaman ini menyegarkan
 * diri tiap beberapa detik selama belum terhubung. Setelah terhubung, polling
 * melambat — cukup untuk memantau kesehatan koneksi.
 */

const POLL_PAIRING_MS = 4000;
const POLL_CONNECTED_MS = 30000;

export function WaGatewayPage() {
  const [tab, setTab] = useState<"status" | "history">("status");
  // QR pairing berganti ±20 detik: poll cepat selama belum terhubung.
  const gatewayQuery = useQuery({
    queryKey: ["settings", "wa-gateway"],
    queryFn: fetchGatewayState,
    refetchInterval: (query) =>
      query.state.data?.status?.connected ? POLL_CONNECTED_MS : POLL_PAIRING_MS,
  });
  const state = gatewayQuery.data ?? null;
  const loading =
    gatewayQuery.isLoading || (gatewayQuery.isFetching && !gatewayQuery.data);
  const error =
    gatewayQuery.error instanceof Error ? gatewayQuery.error.message : null;
  const load = async () => {
    await gatewayQuery.refetch();
  };

  const status = state?.status ?? null;
  const connected = status?.connected ?? false;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="border-b border-slate-200 pb-4">
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="size-4" />
            Settings
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
            <MessageCircle className="size-6 text-emerald-600" />
            WhatsApp Gateway
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Koneksi nomor pengirim OTP portal member &amp; notifikasi WhatsApp.
            Pindai QR di bawah dari HP yang ingin dijadikan nomor pengirim untuk
            menautkan.
          </p>
        </div>

        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          {(
            [
              ["status", "Status & Pairing", Smartphone],
              ["history", "Riwayat Pesan", History],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                tab === value
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "history" ? (
          <WaMessageHistory />
        ) : (
          <>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-slate-400" />
              </div>
            ) : !state?.configured ? (
              <>
                <StatusCard
                  icon={ShieldAlert}
                  tone="amber"
                  title="Gateway belum dikonfigurasi"
                  description="Isi alamat gateway dan token di bawah — tersimpan di database, berlaku tanpa deploy ulang. Nomor pengirim ditentukan saat pairing QR, bukan di sini."
                />
                <GatewayConfigForm settings={state?.settings} onSaved={load} />
              </>
            ) : state.reachable === false ? (
              <>
                <StatusCard
                  icon={WifiOff}
                  tone="red"
                  title="Gateway tidak merespons"
                  description="Proses wa-gateway mati, atau alamat gateway di bawah salah. Cek pm2 restart wa-gateway, atau perbaiki alamatnya."
                />
                <GatewayConfigForm settings={state.settings} onSaved={load} />
              </>
            ) : connected ? (
              <StatusCard
                icon={CheckCircle2}
                tone="emerald"
                title={`Terhubung sebagai +${status?.phone ?? "?"}`}
                description={`Terakhir tersambung ${formatDateTime(status?.lastConnectedAt ?? null)}. OTP portal member dikirim lewat nomor ini.`}
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <Smartphone className="mt-0.5 size-5 shrink-0 text-slate-500" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">
                      Menunggu pairing
                    </h2>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-slate-600">
                      <li>
                        Buka WhatsApp di HP yang ingin dijadikan nomor pengirim
                        bisnis ini
                      </li>
                      <li>
                        Setelan → <strong>Perangkat Tertaut</strong> →{" "}
                        <strong>Tautkan Perangkat</strong>
                      </li>
                      <li>Pindai QR di bawah</li>
                    </ol>
                  </div>
                </div>

                <div className="mt-6 flex flex-col items-center gap-3">
                  {state.qr ? (
                    <>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <QRCodeSVG value={state.qr} size={264} marginSize={1} />
                      </div>
                      <p className="text-xs text-slate-400">
                        QR berganti otomatis setiap ±20 detik — halaman ini ikut
                        menyegarkan sendiri.
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-10 text-sm text-slate-500">
                      <Loader2 className="size-6 animate-spin" />
                      Menyiapkan QR dari gateway...
                    </div>
                  )}
                </div>

                {status?.lastDisconnectReason && (
                  <p className="mt-4 text-center text-xs text-slate-400">
                    Terakhir terputus: alasan {status.lastDisconnectReason}
                    {status.lastConnectedAt &&
                      ` · tersambung terakhir ${formatDateTime(status.lastConnectedAt)}`}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <RefreshCw className="size-4" />
                Muat ulang
              </button>
            </div>

            <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
              <strong className="text-slate-700">Catatan keamanan:</strong> QR
              di halaman ini adalah kredensial sesi WhatsApp — siapa pun yang
              memindainya menautkan nomor bisnis ke perangkatnya. Halaman ini
              hanya bisa dibuka Super Admin; jangan membagikan tangkapan
              layarnya.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "red";
  title: string;
  description: string;
}) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  const iconTones = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-5 py-4 ${tones[tone]}`}
    >
      <Icon className={`mt-0.5 size-6 shrink-0 ${iconTones[tone]}`} />
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm opacity-80">{description}</p>
      </div>
    </div>
  );
}

/**
 * Form konfigurasi gateway — tersimpan di configuration.app_settings (EPIC
 * pola DeepSeek/Google BP), jadi tiap instance bisa menunjuk gateway berbeda
 * tanpa menyentuh ENV/CI. Token tampil hanya sebagai versi tersamar; field
 * yang dikosongkan berarti "biarkan nilai lama".
 */
function GatewayConfigForm({
  settings,
  onSaved,
}: {
  settings?: GatewayState["settings"];
  onSaved: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState(settings?.url ?? "");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const result = await saveGatewayConfig({
        url,
        ...(token ? { token } : {}),
      });
      setToken("");
      setMessage(
        result.reachable
          ? "Tersimpan — gateway merespons."
          : "Tersimpan, tapi gateway belum merespons di alamat itu.",
      );
      await onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">
        Konfigurasi Gateway
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Alamat service wa-gateway dan token aksesnya (header{" "}
        <code className="rounded bg-slate-100 px-1">x-gateway-token</code>).
        Dari aplikasi yang berjalan di Docker, alamat host biasanya{" "}
        <code className="rounded bg-slate-100 px-1">
          http://host.docker.internal:3471
        </code>
        .
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Alamat gateway
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://host.docker.internal:3471"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              settings?.token_masked
                ? `Tersimpan: ${settings.token_masked} — isi hanya untuk mengganti`
                : settings?.token_from_env
                  ? "Sedang memakai token dari ENV — isi untuk pindah ke database"
                  : "Token dari services/wa-gateway/.env"
            }
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>
      </div>

      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        Simpan & cek koneksi
      </button>
    </div>
  );
}
