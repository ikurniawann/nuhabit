"use client";

import { useEffect, useState } from "react";
import {
  normalizeWaRecipient,
  type WaNotifConfig,
  type WaNotifType,
  type WaNotifTypeMeta,
} from "@/lib/wa/notifications-config";

/**
 * Panel konfigurasi notifikasi WA owner (EPIC-020) — dirender di dalam
 * WindowShell desktop (Settings → Notifikasi WA). Mengatur: saklar utama,
 * jenis notifikasi mana yang aktif, nomor penerima, dan ambang void.
 */

const TIER_LABELS: Record<WaNotifTypeMeta["tier"], { title: string; note: string }> = {
  kritis: { title: "Kritis", note: "Dikirim seketika, kapan pun terjadi" },
  harian: { title: "Ringkasan Harian", note: "Satu pesan di jam tutup" },
  ambang: { title: "Ambang & Pengingat", note: "Hanya saat melewati batas" },
};

export type WaNotifTone = "dark" | "light";

/**
 * Dua palet untuk satu form: "dark" = jendela Settings di desktop /arkiv-os
 * (tempat asli komponen ini, EPIC-020), "light" = halaman
 * /dashboard/settings/wa-notifications. Satu komponen dua kulit — bukan dua
 * salinan form yang bisa saling basi.
 */
const TONES = {
  dark: {
    base: "text-white",
    card: "rounded-3xl border border-white/14 bg-slate-950/55 p-4",
    chip: "inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-slate-950/55 px-3 py-1 text-xs",
    chipRemove: "text-white/45 transition hover:text-rose-300",
    addBtn: "shrink-0 rounded-xl bg-white/12 px-4 py-2 text-sm font-semibold transition hover:bg-white/18",
    input: "arkiv-glass-input border",
    sub: "text-white/45",
    sub2: "text-white/40",
    sub3: "text-white/55",
    err: "text-rose-300",
    ok: "text-emerald-300",
    pulse: "bg-white/10",
    pre: "border border-white/10 bg-black/25 text-white/70",
    testBtn: "border border-white/16 bg-white/10 hover:bg-white/16",
    faint: "text-white/35",
    toggleOff: "bg-white/16",
  },
  light: {
    base: "text-gray-900",
    card: "rounded-3xl border border-gray-200 bg-white p-4 shadow-sm",
    chip: "inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700",
    chipRemove: "text-gray-400 transition hover:text-rose-600",
    addBtn: "shrink-0 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800",
    input: "border border-gray-300 bg-white text-gray-900 focus:border-gray-500 focus:outline-none",
    sub: "text-gray-500",
    sub2: "text-gray-400",
    sub3: "text-gray-600",
    err: "text-rose-600",
    ok: "text-emerald-600",
    pulse: "bg-gray-200",
    pre: "border border-gray-200 bg-gray-50 text-gray-700",
    testBtn: "border border-gray-300 bg-white hover:bg-gray-50",
    faint: "text-gray-400",
    toggleOff: "bg-gray-300",
  },
} as const;

function Toggle({ on, onChange, label, offClass = "bg-white/16" }: { on: boolean; onChange: (v: boolean) => void; label: string; offClass?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-pink-500" : offClass}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function WaNotifSettingsPanel({ tone = "dark" }: { tone?: WaNotifTone } = {}) {
  const ui = TONES[tone];
  const [config, setConfig] = useState<WaNotifConfig | null>(null);
  const [catalog, setCatalog] = useState<WaNotifTypeMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [shiftRecipients, setShiftRecipients] = useState<string[]>([]);
  const [shiftPhoneInput, setShiftPhoneInput] = useState("");
  const [shiftPhoneError, setShiftPhoneError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/wa-notifications");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Gagal memuat");
        if (!cancelled) {
          setConfig(json.data.config);
          setShiftRecipients(
            Array.isArray(json.data.shift_report_recipients)
              ? json.data.shift_report_recipients
              : []
          );
          setCatalog(json.data.catalog);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Gagal memuat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <div className={`p-5 text-sm ${ui.err}`}>{loadError}</div>;
  if (!config) {
    return (
      <div className="space-y-3 p-5">
        <div className={`h-10 animate-pulse rounded-2xl ${ui.pulse}`} />
        <div className={`h-24 animate-pulse rounded-2xl ${ui.pulse}`} />
        <div className={`h-24 animate-pulse rounded-2xl ${ui.pulse}`} />
      </div>
    );
  }

  const setType = (key: WaNotifType, value: boolean) =>
    setConfig((prev) => (prev ? { ...prev, types: { ...prev.types, [key]: value } } : prev));

  const addPhone = () => {
    const normalized = normalizeWaRecipient(phoneInput);
    if (!normalized) {
      setPhoneError("Nomor tidak valid — pakai format 08… atau 62…");
      return;
    }
    if (config.recipients.includes(normalized)) {
      setPhoneError("Nomor sudah terdaftar");
      return;
    }
    if (config.recipients.length >= 5) {
      setPhoneError("Maksimal 5 nomor");
      return;
    }
    setConfig({ ...config, recipients: [...config.recipients, normalized] });
    setPhoneInput("");
    setPhoneError(null);
  };

  const addShiftPhone = () => {
    const normalized = normalizeWaRecipient(shiftPhoneInput);
    if (!normalized) {
      setShiftPhoneError("Nomor tidak valid — pakai format 08… atau 62…");
      return;
    }
    if (shiftRecipients.includes(normalized)) {
      setShiftPhoneError("Nomor sudah terdaftar");
      return;
    }
    if (shiftRecipients.length >= 10) {
      setShiftPhoneError("Maksimal 10 nomor");
      return;
    }
    setShiftRecipients([...shiftRecipients, normalized]);
    setShiftPhoneInput("");
    setShiftPhoneError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/wa-notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, shift_report_recipients: shiftRecipients }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan");
      setConfig(json.data.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (flash = false) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/wa-notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flash ? { flash: true } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengirim tes");
      const results = json.data.results as Array<{ target: string; success: boolean; reason: string | null }>;
      setTestResult(
        results
          .map((r) => `${r.target}: ${r.success ? "terkirim ✓" : `gagal — ${r.reason ?? "?"}`}`)
          .join("\n")
      );
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Gagal mengirim tes");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`space-y-4 p-5 ${ui.base}`}>
      {/* saklar utama */}
      <div className={`flex items-center gap-3 ${ui.card}`}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Notifikasi WhatsApp</div>
          <div className={`text-xs leading-5 ${ui.sub}`}>
            Kabar penting bisnis dikirim otomatis ke nomor di bawah — tanpa perlu membuka desktop.
          </div>
        </div>
        <Toggle offClass={ui.toggleOff} on={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} label="Aktifkan notifikasi WA" />
      </div>

      {/* nomor penerima */}
      <div className={ui.card}>
        <div className="text-sm font-semibold">Nomor Penerima</div>
        <div className={`mt-1 text-xs ${ui.sub}`}>Maksimal 5 nomor. Format 08… atau 62…</div>
        {config.recipients.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {config.recipients.map((r) => (
              <span key={r} className={ui.chip}>
                {r}
                <button
                  type="button"
                  aria-label={`Hapus ${r}`}
                  onClick={() => setConfig({ ...config, recipients: config.recipients.filter((x) => x !== r) })}
                  className={ui.chipRemove}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={phoneInput}
            onChange={(e) => {
              setPhoneInput(e.target.value);
              setPhoneError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPhone();
              }
            }}
            placeholder="08xxxxxxxxxx"
            inputMode="tel"
            className={`${ui.input} min-w-0 flex-1 rounded-xl px-3 py-2 text-sm`}
          />
          <button
            type="button"
            onClick={addPhone}
            className={ui.addBtn}
          >
            Tambah
          </button>
        </div>
        {phoneError && <p className={`mt-2 text-xs ${ui.err}`}>{phoneError}</p>}
      </div>

      {/* penerima laporan tutup kasir — daftar TERPISAH dari nomor owner di
          atas: laporan shift biasanya ke supervisor/finance, dan dikirim saat
          kasir menekan Cetak di ringkasan tutup kasir. */}
      <div className={ui.card}>
        <div className="text-sm font-semibold">Penerima Laporan Tutup Kasir</div>
        <div className={`mt-1 text-xs ${ui.sub}`}>
          Laporan dikirim otomatis via WA saat kasir mencetak ringkasan tutup
          kasir. Maksimal 10 nomor.
        </div>
        {shiftRecipients.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {shiftRecipients.map((r) => (
              <span key={r} className={ui.chip}>
                {r}
                <button
                  type="button"
                  aria-label={`Hapus ${r}`}
                  onClick={() => setShiftRecipients(shiftRecipients.filter((x) => x !== r))}
                  className={ui.chipRemove}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={shiftPhoneInput}
            onChange={(e) => {
              setShiftPhoneInput(e.target.value);
              setShiftPhoneError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addShiftPhone();
              }
            }}
            placeholder="08xxxxxxxxxx"
            inputMode="tel"
            className={`${ui.input} min-w-0 flex-1 rounded-xl px-3 py-2 text-sm`}
          />
          <button
            type="button"
            onClick={addShiftPhone}
            className={ui.addBtn}
          >
            Tambah
          </button>
        </div>
        {shiftPhoneError && <p className={`mt-2 text-xs ${ui.err}`}>{shiftPhoneError}</p>}
      </div>

      {/* jenis notifikasi per tingkat */}
      {(["kritis", "harian", "ambang"] as const).map((tier) => (
        <div key={tier} className={ui.card}>
          <div className="text-sm font-semibold">{TIER_LABELS[tier].title}</div>
          <div className={`text-xs ${ui.sub2}`}>{TIER_LABELS[tier].note}</div>
          <div className="mt-3 space-y-3">
            {catalog
              .filter((t) => t.tier === tier)
              .map((t) => (
                <div key={t.key} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{t.label}</div>
                    <div className={`text-xs leading-5 ${ui.sub2}`}>{t.description}</div>
                    {t.key === "voidBesar" && config.types.voidBesar && (
                      <div className={`mt-2 flex items-center gap-2 text-xs ${ui.sub3}`}>
                        Ambang: Rp
                        <input
                          value={config.voidThresholdRp.toLocaleString("id-ID")}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ""));
                            setConfig({ ...config, voidThresholdRp: Number.isFinite(n) ? n : 0 });
                          }}
                          inputMode="numeric"
                          className={`${ui.input} w-28 rounded-lg px-2 py-1 text-xs`}
                        />
                      </div>
                    )}
                    {t.key === "omzetAnjlok" && config.types.omzetAnjlok && (
                      <div className={`mt-2 flex items-center gap-2 text-xs ${ui.sub3}`}>
                        Anjlok bila MTD di bawah
                        <input
                          value={String(config.omzetAnjlokPct)}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ""));
                            setConfig({
                              ...config,
                              omzetAnjlokPct: Number.isInteger(n) && n >= 1 && n <= 99 ? n : 80,
                            });
                          }}
                          inputMode="numeric"
                          className={`${ui.input} w-12 rounded-lg px-2 py-1 text-xs`}
                        />
                        % dari target bulanan (bila diisi) / omzet bulan lalu
                      </div>
                    )}
                    {t.key === "digest" && config.types.digest && (
                      <div className={`mt-2 flex items-center gap-2 text-xs ${ui.sub3}`}>
                        Jam kirim (WIB):
                        <input
                          value={String(config.digestHour)}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ""));
                            setConfig({
                              ...config,
                              digestHour: Number.isInteger(n) && n >= 0 && n <= 23 ? n : 0,
                            });
                          }}
                          inputMode="numeric"
                          className={`${ui.input} w-14 rounded-lg px-2 py-1 text-xs`}
                        />
                        :00 — terkirim sekali per hari setelah jam ini
                      </div>
                    )}
                  </div>
                  <Toggle offClass={ui.toggleOff} on={config.types[t.key]} onChange={(v) => setType(t.key, v)} label={t.label} />
                </div>
              ))}
          </div>
        </div>
      ))}

      {/* aksi */}
      {saveError && <p className={`text-sm ${ui.err}`}>{saveError}</p>}
      {testResult && (
        <pre className={`whitespace-pre-wrap rounded-2xl p-3 text-xs ${ui.pre}`}>{testResult}</pre>
      )}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground shadow-lg transition hover:brightness-105 disabled:opacity-50"
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => void sendTest(false)}
          disabled={testing || config.recipients.length === 0}
          title={config.recipients.length === 0 ? "Tambahkan dan simpan nomor dulu" : "Kirim pesan uji ke semua nomor tersimpan"}
          className={`rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${ui.testBtn}`}
        >
          {testing ? "Mengirim…" : "Kirim Tes"}
        </button>
        <button
          type="button"
          onClick={() => void sendTest(true)}
          disabled={testing || config.recipients.length === 0}
          title="Kirim Daily Flash Report berisi data hari ini (berjalan) ke semua nomor tersimpan"
          className={`rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${ui.testBtn}`}
        >
          {testing ? "Mengirim…" : "Kirim Flash Report (uji)"}
        </button>
        {saved && <span className={`text-sm ${ui.ok}`}>Tersimpan ✓</span>}
        <span className={`ml-auto text-[11px] ${ui.faint}`}>Kirim Tes memakai nomor yang TERSIMPAN, bukan yang belum di-Simpan.</span>
      </div>
    </div>
  );
}
