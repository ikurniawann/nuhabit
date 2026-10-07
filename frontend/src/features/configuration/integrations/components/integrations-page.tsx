"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api-client";
import {
  Bot,
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn } from "@/components/motion";
import { ApiTokensPage } from "@/features/configuration/api-tokens/api-tokens-page";
import { GobizSettingsPanel } from "@/features/gobiz/components/gobiz-settings-panel";

interface ProviderConfig {
  api_key_masked: string | null;
  has_api_key: boolean;
  model: string;
  base_url: string;
}

interface IntegrationsData {
  deepseek: ProviderConfig;
  openai: ProviderConfig;
}

type ProviderId = "deepseek" | "openai";

const INTEGRATIONS_URL = "/api/settings/integrations";
const INTEGRATIONS_KEY = ["settings", "integrations"] as const;

const PROVIDER_META: Record<
  ProviderId,
  {
    title: string;
    description: string;
    icon: typeof Bot;
    iconClass: string;
    keyPlaceholder: string;
  }
> = {
  deepseek: {
    title: "DeepSeek AI",
    description:
      "Dipakai untuk analisis CV kandidat dan insight psikotes (teks).",
    icon: Bot,
    iconClass: "bg-sky-100 text-sky-700",
    keyPlaceholder: "sk-…",
  },
  openai: {
    title: "OpenAI (Vision)",
    description:
      "Dipakai untuk membaca gambar tes psikotes (Baum/DAP/Wartegg) secara otomatis — DeepSeek tidak mendukung input gambar.",
    icon: ImagePlus,
    iconClass: "bg-emerald-100 text-emerald-700",
    keyPlaceholder: "sk-proj-…",
  },
};

/** Payload PUT: DeepSeek pakai field flat (kompatibel payload lama),
 *  OpenAI dibungkus objek `openai`. */
function buildPayload(provider: ProviderId, fields: Record<string, unknown>) {
  return provider === "deepseek" ? fields : { openai: fields };
}

function ProviderCard({
  provider,
  config,
  onSaved,
}: {
  provider: ProviderId;
  config: ProviderConfig;
  onSaved: () => Promise<void>;
}) {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(config.model);
  const [baseUrl, setBaseUrl] = useState(config.base_url);

  const putConfig = async (fields: Record<string, unknown>) => {
    await apiPut(INTEGRATIONS_URL, buildPayload(provider, fields));
    await onSaved();
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const fields: Record<string, unknown> = { model, base_url: baseUrl };
      // API key hanya dikirim kalau user mengetik sesuatu (biar tidak menimpa
      // key tersimpan dengan string kosong secara tidak sengaja)
      if (apiKey.trim()) fields.api_key = apiKey.trim();
      await putConfig(fields);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!confirm(`Hapus API key ${meta.title} yang tersimpan?`)) return;
    setSaving(true);
    setError(null);
    try {
      await putConfig({ api_key: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus key");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <div
          className={`flex size-9 items-center justify-center rounded-lg ${meta.iconClass}`}
        >
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold">{meta.title}</div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        {config.has_api_key && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <Check className="size-3" /> Terkonfigurasi
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:max-w-xl">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">API Key</Label>
          {config.has_api_key && (
            <p className="text-xs text-muted-foreground">
              Key tersimpan:{" "}
              <code className="rounded bg-muted px-1">
                {config.api_key_masked}
              </code>{" "}
              — isi field di bawah hanya jika ingin mengganti.
            </p>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  config.has_api_key
                    ? `${meta.keyPlaceholder} (ganti key)`
                    : meta.keyPlaceholder
                }
                className="pl-9 pr-9"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? "Sembunyikan key" : "Tampilkan key"}
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {config.has_api_key && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRemoveKey}
                disabled={saving}
              >
                Hapus Key
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Simpan Konfigurasi
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <Check className="size-4" /> Tersimpan
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const integrationsQuery = useQuery({
    queryKey: INTEGRATIONS_KEY,
    queryFn: () =>
      apiGet<{ data: IntegrationsData }>(INTEGRATIONS_URL).then((r) => r.data),
  });
  const data = integrationsQuery.data ?? null;
  const loading = integrationsQuery.isLoading;
  const loadError =
    integrationsQuery.error instanceof Error
      ? integrationsQuery.error.message
      : null;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <FadeIn className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Integrasi</h1>
        <p className="text-sm text-muted-foreground">
          Konfigurasi layanan eksternal. API key disimpan di server dan tidak
          pernah ditampilkan penuh setelah disimpan.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {data && (
        <>
          <ProviderCard
            provider="deepseek"
            config={data.deepseek}
            onSaved={refresh}
          />
          <ProviderCard
            provider="openai"
            config={data.openai}
            onSaved={refresh}
          />
        </>
      )}

      {/* EPIC-049 — GoBiz / GoFood. Menu Settings → Integrasi membuka halaman ini,
          bukan /dashboard/integration (Integration Center lama tanpa tautan menu),
          jadi panelnya harus ada di sini. */}
      <div className="border-t pt-6">
        <GobizSettingsPanel />
      </div>

      {/* EPIC-042 — Open API tokens utk agent eksternal; owner minta dikelola
          dari halaman Integrasi ini (2026-08-23), bukan halaman terpisah. */}
      <div className="border-t pt-6">
        <ApiTokensPage />
      </div>
    </FadeIn>
  );
}
