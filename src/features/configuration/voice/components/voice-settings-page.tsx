"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Play,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn } from "@/components/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TtsProvider, TtsProviderId } from "@/lib/tts/catalog";

interface TtsSettingsData {
  provider: TtsProviderId;
  voice: string;
  model: string;
  catalog: Record<TtsProviderId, TtsProvider>;
  credentials: {
    openai: { configured: boolean };
    azure: { configured: boolean; key_masked: string | null; region: string };
    elevenlabs: { configured: boolean; key_masked: string | null };
  };
}

function SecretInput({
  label,
  value,
  onChange,
  placeholder,
  masked,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  masked: string | null;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {masked && (
        <p className="text-xs text-muted-foreground">
          Tersimpan: <code className="rounded bg-muted px-1">{masked}</code> — isi hanya
          jika ingin mengganti.
        </p>
      )}
      <div className="relative">
        <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Sembunyikan" : "Tampilkan"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function VoiceSettingsPage() {
  const [data, setData] = useState<TtsSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provider, setProvider] = useState<TtsProviderId>("openai");
  const [voice, setVoice] = useState("");
  const [model, setModel] = useState("");
  const [azureKey, setAzureKey] = useState("");
  const [azureRegion, setAzureRegion] = useState("");
  const [elevenKey, setElevenKey] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = async () => {
    const res = await fetch("/api/settings/tts");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Gagal memuat konfigurasi");
    const d = json.data as TtsSettingsData;
    setData(d);
    setProvider(d.provider);
    setVoice(d.voice);
    setModel(d.model);
    setAzureRegion(d.credentials.azure.region);
    return d;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Gagal memuat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const meta = data?.catalog[provider];

  /** Ganti provider = reset voice/model ke default provider itu; nilai lama
   *  milik provider sebelumnya tidak berarti apa-apa di sini. */
  const handleProviderChange = (next: string) => {
    const id = next as TtsProviderId;
    const nextMeta = data?.catalog[id];
    setProvider(id);
    setVoice(nextMeta?.defaultVoice ?? "");
    setModel(nextMeta?.defaultModel ?? "");
    setPreviewSrc(null);
    setPreviewMeta(null);
    setPreviewError(null);
  };

  const voiceIsCustom = useMemo(() => {
    if (!meta) return false;
    if (meta.voices.length === 0) return true;
    return !meta.voices.some((v) => v.id === voice);
  }, [meta, voice]);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    setPreviewSrc(null);
    try {
      const res = await fetch("/api/settings/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, voice, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal membuat preview");
      setPreviewSrc(`data:audio/mpeg;base64,${json.data.audio_base64}`);
      setPreviewMeta(`${json.data.provider} · ${json.data.voice} · ${json.data.model}`);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Gagal membuat preview");
    } finally {
      setPreviewing(false);
    }
  };

  // Autoplay begitu audio preview siap — admin baru saja menekan tombol,
  // jadi syarat interaksi user untuk autoplay sudah terpenuhi.
  useEffect(() => {
    if (previewSrc && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {
        /* diblokir browser — user masih bisa menekan tombol play di elemen audio */
      });
    }
  }, [previewSrc]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = { provider, voice, model };
      if (azureKey.trim()) payload.azure_key = azureKey.trim();
      if (azureRegion.trim() !== (data?.credentials.azure.region ?? "")) {
        payload.azure_region = azureRegion.trim();
      }
      if (elevenKey.trim()) payload.elevenlabs_key = elevenKey.trim();

      const res = await fetch("/api/settings/tts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan");

      setAzureKey("");
      setElevenKey("");
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const credentialWarning =
    provider === "azure" && !data?.credentials.azure.configured && !azureKey.trim()
      ? "Azure Speech key & region belum tersimpan — preview akan gagal sampai keduanya diisi."
      : provider === "elevenlabs" && !data?.credentials.elevenlabs.configured && !elevenKey.trim()
        ? "ElevenLabs API key belum tersimpan — preview akan gagal sampai diisi."
        : provider === "openai" && !data?.credentials.openai.configured
          ? "API key OpenAI belum diisi di Settings → Integrasi."
          : null;

  return (
    <FadeIn className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Suara AI</h1>
        <p className="text-sm text-muted-foreground">
          Suara yang membacakan pertanyaan Interview AI. Dengarkan dulu lewat tombol
          preview sebelum menyimpan.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {data && meta && (
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Volume2 className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Provider Text-to-Speech</div>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:max-w-xl">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Provider</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(data.catalog).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Suara</Label>
              {meta.voices.length > 0 && (
                <Select value={voiceIsCustom ? "" : voice} onValueChange={setVoice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih suara" />
                  </SelectTrigger>
                  <SelectContent>
                    {meta.voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label}
                        {v.nativeIndonesian ? " — penutur asli id-ID" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {meta.allowCustomVoice && (
                <Input
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  placeholder={
                    provider === "elevenlabs"
                      ? "Voice ID dari dashboard ElevenLabs"
                      : "Atau ketik nama voice lain, mis. id-ID-ArdiNeural"
                  }
                />
              )}
              {!meta.voices.some((v) => v.nativeIndonesian) && meta.voices.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Semua suara provider ini penutur asli Inggris — bahasa Indonesia akan
                  terdengar beraksen berapa pun instruksinya.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meta.models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {provider === "openai" && model !== "gpt-4o-mini-tts" && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Hanya <code className="rounded bg-muted px-1">gpt-4o-mini-tts</code> yang
                  menerima instruksi pelafalan Indonesia; model lain mengabaikannya.
                </p>
              )}
            </div>

            {provider === "azure" && (
              <div className="grid gap-4 rounded-lg border border-dashed p-4">
                <SecretInput
                  label="Azure Speech Key"
                  value={azureKey}
                  onChange={setAzureKey}
                  placeholder="kunci langganan Speech"
                  masked={data.credentials.azure.key_masked}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Region</Label>
                  <Input
                    value={azureRegion}
                    onChange={(e) => setAzureRegion(e.target.value)}
                    placeholder="southeastasia"
                  />
                </div>
              </div>
            )}

            {provider === "elevenlabs" && (
              <div className="rounded-lg border border-dashed p-4">
                <SecretInput
                  label="ElevenLabs API Key"
                  value={elevenKey}
                  onChange={setElevenKey}
                  placeholder="sk_…"
                  masked={data.credentials.elevenlabs.key_masked}
                />
              </div>
            )}

            {credentialWarning && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {credentialWarning}
              </p>
            )}

            <div className="rounded-lg bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={handlePreview} disabled={previewing}>
                  {previewing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Dengarkan Preview
                </Button>
                {previewMeta && (
                  <span className="text-xs text-muted-foreground">{previewMeta}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Memakai kalimat pembuka wawancara yang sesungguhnya. Preview tidak
                mengubah pengaturan tersimpan — kredensial baru perlu Disimpan dulu.
              </p>
              {previewError && <p className="mt-2 text-sm text-red-600">{previewError}</p>}
              {previewSrc && (
                <audio ref={audioRef} controls className="mt-3 w-full" src={previewSrc}>
                  Browser Anda tidak mendukung pemutar audio.
                </audio>
              )}
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

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
      )}
    </FadeIn>
  );
}
