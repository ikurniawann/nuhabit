"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, X } from "lucide-react";

/**
 * SOP di Coach Portal (EPIC-067 T-067-D1): banner selama ada versi SOP yang
 * belum dikonfirmasi, dan panel baca + "Saya sudah membaca dan setuju".
 */

interface SopItem {
  document_id: string;
  version_id: string;
  version: number;
  title: string;
  body: string;
  change_note: string | null;
  acknowledged_at: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

export function useCoachSop() {
  const [items, setItems] = useState<SopItem[] | null>(null);
  const load = useCallback(
    () =>
      request<{ data: SopItem[] }>("/api/coach/sop")
        .then((r) => setItems(r.data))
        .catch(() => setItems([])),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  return { items, reload: load, pending: (items ?? []).filter((i) => !i.acknowledged_at).length };
}

export function CoachSopBanner({ pending, onOpen }: { pending: number; onOpen: () => void }) {
  if (pending === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-nh-lime px-4 py-3 text-left text-nh-forest"
    >
      <FileText className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 text-sm font-semibold">
        {pending === 1 ? "Ada 1 SOP" : `Ada ${pending} SOP`} yang perlu dibaca & dikonfirmasi
      </span>
      <span className="shrink-0 text-xs font-bold underline underline-offset-4">Baca</span>
    </button>
  );
}

export function CoachSopSheet({ items, onClose, onChanged }: { items: SopItem[]; onClose: () => void; onChanged: () => Promise<unknown> }) {
  return (
    <div className="fixed inset-0 z-30 mx-auto flex max-w-xl flex-col bg-nh-forest">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-display text-base font-semibold">SOP Coach</h2>
        <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-full p-2 text-nh-beige/70 hover:bg-white/10">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <p className="text-center text-sm text-nh-beige/70">Belum ada SOP.</p>
        ) : (
          items.map((i) => <SopCard key={i.version_id} item={i} onChanged={onChanged} />)
        )}
      </div>
    </div>
  );
}

function SopCard({ item: i, onChanged }: { item: SopItem; onChanged: () => Promise<unknown> }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await request(`/api/coach/sop/${i.version_id}/ack`, { method: "POST" });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`rounded-2xl border p-4 ${i.acknowledged_at ? "border-white/10 bg-white/5" : "border-nh-lime/50 bg-nh-lime/5"}`}>
      <p className="font-semibold">{i.title}</p>
      <p className="mt-0.5 text-xs text-nh-beige/60">
        Versi {i.version}
        {i.change_note ? ` · Perubahan: ${i.change_note}` : ""}
      </p>
      <div className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-sm leading-relaxed text-nh-beige/90">{i.body}</div>
      {i.acknowledged_at ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-nh-lime">
          <CheckCircle2 className="size-4" /> Anda sudah menyetujui versi ini
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#daff59]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            Saya sudah membaca dan setuju menjalankan SOP ini
          </label>
          <button
            type="button"
            disabled={!agree || busy}
            onClick={confirm}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-nh-lime py-2.5 text-sm font-semibold text-nh-forest disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Konfirmasi
          </button>
          {err && <p className="text-xs text-red-300">{err}</p>}
        </div>
      )}
    </article>
  );
}
