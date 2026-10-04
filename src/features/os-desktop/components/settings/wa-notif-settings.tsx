"use client";

import { useEffect, useRef, useState } from "react";
import type { WaNotifConfig, WaNotifType, WaNotifTypeMeta } from "@/lib/wa/notifications-config";
import { useSaveWaNotifSettings, useSendWaNotifTest, useWaNotifSettings, type WaNotifSettings } from "../../hooks/use-wa-notif-settings";
import { addWaRecipient, parseBoundedInt } from "../../lib/wa-recipients";

/**
 * Panel konfigurasi notifikasi WA owner (EPIC-020): saklar utama, jenis
 * notifikasi aktif, nomor penerima, dan ambang. Dirender di jendela Settings
 * desktop /os dan di halaman /dashboard/settings/wa-notifications.
 */

const TIER_LABELS: Record<WaNotifTypeMeta["tier"], { title: string; note: string }> = {
  kritis: { title: "Kritis", note: "Dikirim seketika, kapan pun terjadi" },
  harian: { title: "Ringkasan Harian", note: "Satu pesan di jam tutup" },
  ambang: { title: "Ambang & Pengingat", note: "Hanya saat melewati batas" },
};

export type WaNotifTone = "dark" | "light";

/** Satu form dua kulit: "dark" = jendela desktop, "light" = halaman dashboard. */
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

type Ui = (typeof TONES)[WaNotifTone];

function Toggle({ on, onChange, label, offClass }: { on: boolean; onChange: (v: boolean) => void; label: string; offClass: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-pink-500" : offClass}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Daftar nomor WA dengan chip hapus dan input tambah. */
function RecipientList({
  ui,
  title,
  note,
  max,
  recipients,
  onChange,
}: {
  ui: Ui;
  title: string;
  note: string;
  max: number;
  recipients: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const result = addWaRecipient(recipients, input, max);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange(result.list);
    setInput("");
    setError(null);
  };

  return (
    <div className={ui.card}>
      <div className="text-sm font-semibold">{title}</div>
      <div className={`mt-1 text-xs ${ui.sub}`}>{note}</div>
      {recipients.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {recipients.map((r) => (
            <span key={r} className={ui.chip}>
              {r}
              <button type="button" aria-label={`Hapus ${r}`} onClick={() => onChange(recipients.filter((x) => x !== r))} className={ui.chipRemove}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="08xxxxxxxxxx"
          inputMode="tel"
          className={`${ui.input} min-w-0 flex-1 rounded-xl px-3 py-2 text-sm`}
        />
        <button type="button" onClick={add} className={ui.addBtn}>
          Tambah
        </button>
      </div>
      {error && <p className={`mt-2 text-xs ${ui.err}`}>{error}</p>}
    </div>
  );
}

/** Input angka kecil di bawah jenis notifikasi yang punya ambang. */
function ThresholdInput({ ui, value, width, onChange }: { ui: Ui; value: string; width: string; onChange: (raw: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" className={`${ui.input} ${width} rounded-lg px-2 py-1 text-xs`} />;
}

function WaNotifForm({ ui, initial }: { ui: Ui; initial: WaNotifSettings }) {
  const [config, setConfig] = useState<WaNotifConfig>(initial.config);
  const [shiftRecipients, setShiftRecipients] = useState(initial.shiftRecipients);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);
  const save = useSaveWaNotifSettings();
  const test = useSendWaNotifTest();
  const { catalog } = initial;

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const setType = (key: WaNotifType, value: boolean) => setConfig({ ...config, types: { ...config.types, [key]: value } });

  const submit = () => {
    setSaved(false);
    save.mutate(
      { config, shiftRecipients },
      {
        onSuccess: (data) => {
          setConfig(data.config);
          setSaved(true);
          window.clearTimeout(savedTimer.current);
          savedTimer.current = window.setTimeout(() => setSaved(false), 2500);
        },
      }
    );
  };

  const testOutput = test.data ?? test.error?.message;
  const noRecipients = config.recipients.length === 0;

  return (
    <div className={`space-y-4 p-5 ${ui.base}`}>
      <div className={`flex items-center gap-3 ${ui.card}`}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Notifikasi WhatsApp</div>
          <div className={`text-xs leading-5 ${ui.sub}`}>
            Kabar penting bisnis dikirim otomatis ke nomor di bawah — tanpa perlu membuka desktop.
          </div>
        </div>
        <Toggle offClass={ui.toggleOff} on={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} label="Aktifkan notifikasi WA" />
      </div>

      <RecipientList
        ui={ui}
        title="Nomor Penerima"
        note="Maksimal 5 nomor. Format 08… atau 62…"
        max={5}
        recipients={config.recipients}
        onChange={(recipients) => setConfig({ ...config, recipients })}
      />

      {/* Penerima laporan tutup kasir: daftar TERPISAH dari nomor owner (biasanya
          supervisor/finance), dikirim saat kasir menekan Cetak di ringkasan tutup kasir. */}
      <RecipientList
        ui={ui}
        title="Penerima Laporan Tutup Kasir"
        note="Laporan dikirim otomatis via WA saat kasir mencetak ringkasan tutup kasir. Maksimal 10 nomor."
        max={10}
        recipients={shiftRecipients}
        onChange={setShiftRecipients}
      />

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
                        <ThresholdInput
                          ui={ui}
                          width="w-28"
                          value={config.voidThresholdRp.toLocaleString("id-ID")}
                          onChange={(raw) => setConfig({ ...config, voidThresholdRp: parseBoundedInt(raw, 0, Infinity, 0) })}
                        />
                      </div>
                    )}
                    {t.key === "omzetAnjlok" && config.types.omzetAnjlok && (
                      <div className={`mt-2 flex items-center gap-2 text-xs ${ui.sub3}`}>
                        Anjlok bila MTD di bawah
                        <ThresholdInput
                          ui={ui}
                          width="w-12"
                          value={String(config.omzetAnjlokPct)}
                          onChange={(raw) => setConfig({ ...config, omzetAnjlokPct: parseBoundedInt(raw, 1, 99, 80) })}
                        />
                        % dari target bulanan (bila diisi) / omzet bulan lalu
                      </div>
                    )}
                    {t.key === "digest" && config.types.digest && (
                      <div className={`mt-2 flex items-center gap-2 text-xs ${ui.sub3}`}>
                        Jam kirim (WIB):
                        <ThresholdInput
                          ui={ui}
                          width="w-14"
                          value={String(config.digestHour)}
                          onChange={(raw) => setConfig({ ...config, digestHour: parseBoundedInt(raw, 0, 23, 0) })}
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

      {save.error && <p className={`text-sm ${ui.err}`}>{save.error.message}</p>}
      {testOutput && <pre className={`whitespace-pre-wrap rounded-2xl p-3 text-xs ${ui.pre}`}>{testOutput}</pre>}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground shadow-lg transition hover:brightness-105 disabled:opacity-50"
        >
          {save.isPending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => test.mutate(false)}
          disabled={test.isPending || noRecipients}
          title={noRecipients ? "Tambahkan dan simpan nomor dulu" : "Kirim pesan uji ke semua nomor tersimpan"}
          className={`rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${ui.testBtn}`}
        >
          {test.isPending ? "Mengirim…" : "Kirim Tes"}
        </button>
        <button
          type="button"
          onClick={() => test.mutate(true)}
          disabled={test.isPending || noRecipients}
          title="Kirim Daily Flash Report berisi data hari ini (berjalan) ke semua nomor tersimpan"
          className={`rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${ui.testBtn}`}
        >
          {test.isPending ? "Mengirim…" : "Kirim Flash Report (uji)"}
        </button>
        {saved && <span className={`text-sm ${ui.ok}`}>Tersimpan ✓</span>}
        <span className={`ml-auto text-[11px] ${ui.faint}`}>Kirim Tes memakai nomor yang TERSIMPAN, bukan yang belum di-Simpan.</span>
      </div>
    </div>
  );
}

export function WaNotifSettingsPanel({ tone = "dark" }: { tone?: WaNotifTone }) {
  const ui = TONES[tone];
  const settings = useWaNotifSettings();

  if (settings.error) return <div className={`p-5 text-sm ${ui.err}`}>{settings.error.message}</div>;
  if (!settings.data) {
    return (
      <div className="space-y-3 p-5">
        <div className={`h-10 animate-pulse rounded-2xl ${ui.pulse}`} />
        <div className={`h-24 animate-pulse rounded-2xl ${ui.pulse}`} />
        <div className={`h-24 animate-pulse rounded-2xl ${ui.pulse}`} />
      </div>
    );
  }
  return <WaNotifForm ui={ui} initial={settings.data} />;
}
