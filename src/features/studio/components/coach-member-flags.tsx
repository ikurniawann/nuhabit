"use client";

import { useState } from "react";
import { AlertTriangle, HeartPulse, Loader2, Plus, X } from "lucide-react";
import { FLAG_NOTE_MAX, FLAG_SEVERITIES, type FlagCategory, type FlagSeverity, type FlagType, SEVERITY_LABEL } from "@/lib/studio/member-flags";

/**
 * Penanda perhatian khusus di roster Coach Portal (EPIC-067 T-067-C2): chip per
 * penanda + form catatan coach. Data medis yang tampil di sini sudah disaring
 * server (hanya coach yang memegang sesi hari ini/mendatang atau pembuatnya).
 */

export interface RosterFlag {
  id: string;
  type_label: string;
  category: FlagCategory;
  severity: FlagSeverity;
  note: string | null;
  valid_until: string | null;
  created_by_name: string | null;
  /** 'parq' = dari isian PAR-Q member (T-067-C3). */
  source?: "staff" | "coach" | "parq";
  needs_review?: boolean;
}

const TONE: Record<FlagSeverity, string> = {
  critical: "border-red-300/50 bg-red-400/15 text-red-100",
  attention: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  info: "border-white/15 bg-white/5 text-nh-beige/80",
};

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

const inputClass = "nh-dark-input w-full rounded-xl border px-3 py-2 text-xs outline-none [color-scheme:dark]";

export function RosterMemberFlags({ customerId, flags, onChanged }: { customerId: string; flags: RosterFlag[]; onChanged: () => Promise<unknown> | void }) {
  const [adding, setAdding] = useState(false);
  const [types, setTypes] = useState<FlagType[] | null>(null);
  const [form, setForm] = useState({ type_id: "", severity: "attention" as FlagSeverity, note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setAdding(true);
    setErr(null);
    if (types) return;
    try {
      const list = (await send<{ data: FlagType[] }>("/api/coach/flag-types", {})).data;
      setTypes(list);
      setForm((f) => ({ ...f, type_id: list[0]?.id ?? "" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat jenis");
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/coach/members/${customerId}/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type_id: form.type_id, severity: form.severity, note: form.note.trim() || null }),
      });
      setAdding(false);
      setForm((f) => ({ ...f, note: "" }));
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, keep: boolean) {
    setErr(null);
    try {
      await send(`/api/coach/flags/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep }),
      });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  }

  async function remove(id: string) {
    setErr(null);
    try {
      await send(`/api/coach/flags/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menghapus");
    }
  }

  const selected = types?.find((t) => t.id === form.type_id);

  return (
    <div className="mt-1.5">
      {flags.length > 0 && (
        <ul className="space-y-1">
          {flags.map((f) => (
            <li key={f.id} className={`flex items-start gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${TONE[f.severity]}`}>
              {f.category === "medical" ? <HeartPulse className="mt-px size-3 shrink-0" /> : <AlertTriangle className="mt-px size-3 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{f.type_label}</span>
                {f.source === "parq" && <span className="opacity-70"> · isian member</span>}
                {f.note ? ` · ${f.note}` : ""}
                {f.valid_until ? <span className="opacity-60"> · s/d {f.valid_until}</span> : null}
                {f.needs_review && (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/15 px-1.5 py-px text-[10px] font-semibold">Perlu ditinjau</span>
                    <button type="button" onClick={() => review(f.id, true)} className="font-semibold text-nh-lime underline underline-offset-2">
                      Konfirmasi
                    </button>
                    <button type="button" onClick={() => review(f.id, false)} className="underline underline-offset-2 opacity-80">
                      Tidak relevan
                    </button>
                  </span>
                )}
              </span>
              {!f.needs_review && (
                <button type="button" aria-label={`Hapus ${f.type_label}`} onClick={() => remove(f.id)} className="shrink-0 opacity-60 hover:opacity-100">
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!adding ? (
        <button type="button" onClick={open} className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-nh-beige/60 hover:text-nh-lime">
          <Plus className="size-3" /> Catatan
        </button>
      ) : (
        <div className="mt-1.5 space-y-1.5 rounded-xl bg-nh-forest/60 p-2">
          {!types ? (
            <Loader2 className="size-4 animate-spin text-nh-lime" />
          ) : (
            <>
              <div className="flex gap-1.5">
                <select className={inputClass} value={form.type_id} onChange={(e) => setForm((f) => ({ ...f, type_id: e.target.value }))} aria-label="Jenis catatan">
                  {types.map((t) => (
                    <option key={t.id} value={t.id} className="bg-nh-forest">
                      {t.label}
                      {t.category === "medical" ? " (medis)" : ""}
                    </option>
                  ))}
                </select>
                <select className={`${inputClass} max-w-28`} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as FlagSeverity }))} aria-label="Tingkat">
                  {FLAG_SEVERITIES.map((s) => (
                    <option key={s} value={s} className="bg-nh-forest">
                      {SEVERITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className={inputClass}
                maxLength={FLAG_NOTE_MAX}
                placeholder="Contoh: lutut kiri sakit, hindari lunges"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                aria-label="Catatan"
              />
              {selected?.category === "medical" && <p className="text-[10px] text-nh-beige/50">Catatan medis hanya terlihat oleh coach yang mengajar member ini.</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !form.type_id}
                  onClick={save}
                  className="flex items-center gap-1 rounded-full bg-nh-lime px-3 py-1 text-[11px] font-semibold text-nh-forest disabled:opacity-40"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />} Simpan
                </button>
                <button type="button" onClick={() => setAdding(false)} className="text-[11px] text-nh-beige/60 underline underline-offset-4">
                  Batal
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}
    </div>
  );
}
