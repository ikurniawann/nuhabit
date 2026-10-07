"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, Send, Utensils } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

type GobizSettings = {
  enabled: boolean;
  environment: "sandbox" | "production";
  client_id: string;
  client_secret_masked: string | null;
  has_client_secret: boolean;
  outlet_id: string;
  partner_id: string;
  relay_secret_masked: string | null;
  has_relay_secret: boolean;
  enforce_signature: boolean;
  auto_accept: boolean;
  oauth_url: string;
  api_base_url: string;
  effective_urls: { apiBase: string; oauthUrl: string };
  webhook_url: string;
  configured: boolean;
  last_catalog_sync: { created_at: string; status: string; item_count: number; error: string | null } | null;
};

async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string; data?: T; success?: boolean };
  if (!response.ok || json.success === false) throw new Error(json.error || `Gagal (${response.status})`);
  return json.data as T;
}

/**
 * Panel konfigurasi GoBiz/GoFood (EPIC-049) — dipasang di Settings → Integrasi.
 * Alur: isi kredensial dari GoBiz Developer Portal → Simpan → Tes koneksi →
 * Daftarkan webhook → Sinkron katalog → aktifkan.
 */
export function GobizSettingsPanel() {
  const [data, setData] = useState<GobizSettings | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    environment: "sandbox" as "sandbox" | "production",
    client_id: "",
    client_secret: "",
    outlet_id: "",
    partner_id: "",
    relay_secret: "",
    enforce_signature: false,
    auto_accept: false,
    oauth_url: "",
    api_base_url: "",
  });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookResult, setWebhookResult] = useState<Array<{ event: string; ok: boolean; error?: string }> | null>(null);

  const load = useCallback(async () => {
    const next = await api<GobizSettings>("/api/settings/gobiz");
    setData(next);
    setForm({
      enabled: next.enabled,
      environment: next.environment,
      client_id: next.client_id,
      client_secret: "",
      outlet_id: next.outlet_id,
      partner_id: next.partner_id ?? "",
      relay_secret: "",
      enforce_signature: next.enforce_signature ?? false,
      auto_accept: next.auto_accept,
      oauth_url: next.oauth_url,
      api_base_url: next.api_base_url,
    });
  }, []);

  useEffect(() => {
    // Muat lewat timer supaya setState tidak sinkron di body effect (aturan lint React).
    const timer = window.setTimeout(() => {
      load().catch((error) => toast.error(error instanceof Error ? error.message : "Gagal memuat"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setBusy("save");
    try {
      const body: Record<string, unknown> = { ...form };
      if (!form.client_secret) delete body.client_secret; // kosong = tidak diubah
      if (!form.relay_secret) delete body.relay_secret;
      await api("/api/settings/gobiz", { method: "PUT", body: JSON.stringify(body) });
      toast.success("Konfigurasi GoBiz disimpan");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  }

  async function run(action: "test" | "register_webhooks" | "sync_catalog" | "regenerate_token") {
    setBusy(action);
    try {
      const result = await api<Record<string, unknown>>("/api/settings/gobiz/actions", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (action === "test") toast.success(`Koneksi OK (${String(result.environment)})`);
      if (action === "register_webhooks") {
        const results = result.results as Array<{ event: string; ok: boolean; error?: string }>;
        setWebhookResult(results);
        const failed = results.filter((r) => !r.ok).length;
        if (failed === 0) toast.success(`${results.length} event webhook terdaftar`);
        else toast.warning(`${failed} dari ${results.length} event gagal didaftarkan`);
      }
      if (action === "sync_catalog") {
        const stats = result.stats as { items: number; menus: number; skipped: unknown[] };
        toast.success(`Katalog dikirim: ${stats.items} item, ${stats.menus} kategori${stats.skipped.length ? `, ${stats.skipped.length} dilewati` : ""}`);
      }
      if (action === "regenerate_token") toast.success("Token webhook baru — daftarkan ulang webhook");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aksi gagal");
    } finally {
      setBusy(null);
    }
  }

  async function copyWebhook() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.webhook_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  const inputClass =
    "h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#007aff] focus:ring-2 focus:ring-[#007aff]/20 dark:bg-white/5";

  return (
    <div className="mb-6 overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/[0.04]">
      <div className="flex items-start gap-4 border-b border-black/5 p-5">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-600 text-white shadow-sm">
          <Utensils className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold">GoBiz · GoFood</div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                data?.configured && data.enabled
                  ? "bg-emerald-50 text-emerald-700"
                  : data?.configured
                    ? "bg-amber-50 text-amber-700"
                    : "bg-black/5 text-black/55"
              }`}
            >
              {data ? (data.configured ? (data.enabled ? "Aktif" : "Terkonfigurasi · nonaktif") : "Belum dikonfigurasi") : "…"}
            </span>
            {data && (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/55">
                {data.environment === "production" ? "Production" : "Sandbox"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-black/55">
            Order GoFood masuk otomatis ke POS & KDS, terima/tolak dari halaman POS → GoFood, menu disinkron dari katalog POS.
            Kredensial (Client ID, Client Secret, Outlet ID) diperoleh dari{" "}
            <a href="https://developer.gobiz.com" target="_blank" rel="noreferrer" className="text-[#007aff] underline">
              GoBiz Developer Portal
            </a>
            .
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-black/60">Environment</span>
          <select
            value={form.environment}
            onChange={(event) => setForm((f) => ({ ...f, environment: event.target.value as "sandbox" | "production" }))}
            className={`${inputClass} mt-1`}
          >
            <option value="sandbox">Sandbox (uji coba)</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-black/60">Outlet ID</span>
          <input
            value={form.outlet_id}
            onChange={(event) => setForm((f) => ({ ...f, outlet_id: event.target.value }))}
            placeholder="G123456789"
            className={`${inputClass} mt-1 font-mono`}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-black/60">Client ID</span>
          <input
            value={form.client_id}
            onChange={(event) => setForm((f) => ({ ...f, client_id: event.target.value }))}
            className={`${inputClass} mt-1 font-mono`}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-black/60">
            Client Secret {data?.has_client_secret ? <span className="font-normal text-black/40">(tersimpan: {data.client_secret_masked})</span> : null}
          </span>
          <input
            type="password"
            value={form.client_secret}
            onChange={(event) => setForm((f) => ({ ...f, client_secret: event.target.value }))}
            placeholder={data?.has_client_secret ? "Kosongkan bila tidak diubah" : ""}
            className={`${inputClass} mt-1 font-mono`}
            autoComplete="new-password"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-black/60">Partner ID</span>
          <input
            value={form.partner_id}
            onChange={(event) => setForm((f) => ({ ...f, partner_id: event.target.value }))}
            className={`${inputClass} mt-1 font-mono`}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-black/60">
            Relay secret {data?.has_relay_secret ? <span className="font-normal text-black/40">(tersimpan: {data.relay_secret_masked})</span> : null}
          </span>
          <input
            type="password"
            value={form.relay_secret}
            onChange={(event) => setForm((f) => ({ ...f, relay_secret: event.target.value }))}
            placeholder={data?.has_relay_secret ? "Kosongkan bila tidak diubah" : "Kunci tanda tangan webhook (X-Go-Signature)"}
            className={`${inputClass} mt-1 font-mono`}
            autoComplete="new-password"
          />
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-black/5 px-3 py-2.5 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.enforce_signature}
            disabled={!data?.has_relay_secret}
            onChange={(event) => setForm((f) => ({ ...f, enforce_signature: event.target.checked }))}
            className="h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold">Tolak webhook bertanda tangan salah</span>
            <span className="block text-xs text-black/50">
              Nyalakan setelah uji sandbox membuktikan tanda tangan cocok. Mati = tanda tangan hanya dicatat di log.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-black/5 px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.auto_accept}
            onChange={(event) => setForm((f) => ({ ...f, auto_accept: event.target.checked }))}
            className="h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold">Auto-accept order</span>
            <span className="block text-xs text-black/50">Order langsung diterima & masuk KDS tanpa klik kasir (GoFood batalkan otomatis bila tak diterima 3 menit).</span>
          </span>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-black/5 px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))}
            className="h-4 w-4"
          />
          <span>
            <span className="block text-sm font-semibold">Integrasi aktif</span>
            <span className="block text-xs text-black/50">Tampilkan status di POS → GoFood. Webhook tetap diterima selama token valid.</span>
          </span>
        </label>

        <div className="sm:col-span-2">
          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs font-semibold text-[#007aff]">
            {advanced ? "Sembunyikan" : "Tampilkan"} pengaturan lanjutan (URL API)
          </button>
          {advanced && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-black/60">OAuth token URL (override)</span>
                <input
                  value={form.oauth_url}
                  onChange={(event) => setForm((f) => ({ ...f, oauth_url: event.target.value }))}
                  placeholder={data?.effective_urls.oauthUrl}
                  className={`${inputClass} mt-1 font-mono text-xs`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-black/60">API base URL (override)</span>
                <input
                  value={form.api_base_url}
                  onChange={(event) => setForm((f) => ({ ...f, api_base_url: event.target.value }))}
                  placeholder={data?.effective_urls.apiBase}
                  className={`${inputClass} mt-1 font-mono text-xs`}
                />
              </label>
              <p className="text-xs text-black/45 sm:col-span-2">
                Default sandbox: <code>api.partner-sandbox.gobiz.co.id</code> / <code>integration-goauth.gojekapi.com</code>.
                URL produksi dikonfirmasi ke tim GoBiz saat kredensial produksi diberikan.
              </p>
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <span className="text-xs font-semibold text-black/60">URL webhook (didaftarkan ke GoBiz)</span>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-black/5 px-3 py-2 text-xs">{data?.webhook_url || "…"}</code>
            <Button type="button" variant="outline" size="sm" onClick={copyWebhook} className="h-9">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => run("regenerate_token")} disabled={busy !== null} className="h-9" title="Token baru">
              {busy === "regenerate_token" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-black/5 bg-black/[0.02] p-5">
        <Button type="button" onClick={save} disabled={busy !== null} className="h-10 rounded-full bg-[#007aff] px-5 hover:bg-[#006ee6]">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Simpan
        </Button>
        <Button type="button" variant="outline" onClick={() => run("test")} disabled={busy !== null || !data?.configured} className="h-10 rounded-full">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Tes koneksi
        </Button>
        <Button type="button" variant="outline" onClick={() => run("register_webhooks")} disabled={busy !== null || !data?.configured} className="h-10 rounded-full">
          {busy === "register_webhooks" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Daftarkan webhook
        </Button>
        <Button type="button" variant="outline" onClick={() => run("sync_catalog")} disabled={busy !== null || !data?.configured} className="h-10 rounded-full">
          {busy === "sync_catalog" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Utensils className="h-4 w-4" />}
          Sinkron katalog ke GoFood
        </Button>
        {data?.last_catalog_sync && (
          <span className="ml-auto text-xs text-black/50">
            Sinkron terakhir: {formatDateTime(data.last_catalog_sync.created_at)} ·{" "}
            {data.last_catalog_sync.status === "success"
              ? `${data.last_catalog_sync.item_count} item`
              : data.last_catalog_sync.status === "failed"
                ? `gagal: ${data.last_catalog_sync.error}`
                : "terkirim"}
          </span>
        )}
      </div>

      {webhookResult && (
        <div className="border-t border-black/5 p-5">
          <div className="text-xs font-semibold text-black/60">Hasil pendaftaran webhook</div>
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {webhookResult.map((row) => (
              <li key={row.event} className={row.ok ? "text-emerald-700" : "text-red-700"}>
                {row.ok ? "✓" : "✗"} {row.event}
                {row.error ? ` — ${row.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
