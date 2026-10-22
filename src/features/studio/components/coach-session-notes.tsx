"use client";

import { useState } from "react";
import { Loader2, MessageSquarePlus, Pin, X } from "lucide-react";
import { SESSION_NOTE_MAX, type SessionNote } from "@/lib/studio/session-notes";

/**
 * Catatan coach setelah sesi di roster Coach Portal (EPIC-067 T-067-C4):
 * catatan yang "dibawa ke sesi berikutnya" (dari coach mana pun) di atas,
 * riwayat singkat di bawahnya, dan form catatan untuk sesi ini.
 */

export type RosterNote = SessionNote & { mine: boolean };

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

const tgl = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
const inputClass = "nh-dark-input w-full rounded-xl border px-3 py-2 text-xs outline-none [color-scheme:dark]";

export function RosterSessionNotes({
  sessionId,
  customerId,
  notes,
  canWrite,
  onChanged,
}: {
  sessionId: string;
  customerId: string;
  notes: RosterNote[];
  canWrite: boolean;
  onChanged: () => Promise<unknown> | void;
}) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const [carry, setCarry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  }

  async function save() {
    setBusy(true);
    await run(async () => {
      await send(`/api/coach/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, body: body.trim(), carry_forward: carry }),
      });
      setWriting(false);
      setBody("");
      setCarry(true);
    });
    setBusy(false);
  }

  return (
    <div className="mt-1.5">
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n) => (
            <li key={n.id} className={`flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] ${n.pinned ? "bg-nh-lime/10 text-nh-beige" : "text-nh-beige/60"}`}>
              {n.pinned ? <Pin className="mt-px size-3 shrink-0 text-nh-lime" /> : <span className="mt-1.5 size-1 shrink-0 rounded-full bg-nh-beige/40" />}
              <span className="min-w-0 flex-1">
                {n.body}
                <span className="opacity-60">
                  {" "}
                  · {n.mine ? "Anda" : n.coach_name}, {tgl(n.session_date ?? n.created_at)}
                  {n.session_label ? ` (${n.session_label})` : ""}
                </span>
                {n.pinned && (
                  <button type="button" onClick={() => run(() => send(`/api/coach/notes/${n.id}/release`, { method: "POST" }))} className="ml-2 underline underline-offset-2 opacity-70 hover:opacity-100">
                    Tidak perlu dibawa lagi
                  </button>
                )}
              </span>
              {n.mine && (
                <button type="button" aria-label="Hapus catatan" onClick={() => run(() => send(`/api/coach/notes/${n.id}`, { method: "DELETE" }))} className="shrink-0 opacity-50 hover:opacity-100">
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite &&
        (!writing ? (
          <button type="button" onClick={() => setWriting(true)} className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-nh-beige/60 hover:text-nh-lime">
            <MessageSquarePlus className="size-3" /> Catatan sesi
          </button>
        ) : (
          <div className="mt-1.5 space-y-1.5 rounded-xl bg-nh-forest/60 p-2">
            <textarea
              rows={2}
              className={inputClass}
              maxLength={SESSION_NOTE_MAX}
              placeholder="Contoh: lutut kiri masih nyeri, ganti lunges dengan step-up"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Catatan sesi"
            />
            <label className="flex items-center gap-2 text-[11px] text-nh-beige/80">
              <input type="checkbox" className="size-3.5 accent-[#daff59]" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
              Bawa ke sesi berikutnya (terlihat coach lain yang mengajar member ini)
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || body.trim().length < 3}
                onClick={save}
                className="flex items-center gap-1 rounded-full bg-nh-lime px-3 py-1 text-[11px] font-semibold text-nh-forest disabled:opacity-40"
              >
                {busy && <Loader2 className="size-3 animate-spin" />} Simpan
              </button>
              <button type="button" onClick={() => setWriting(false)} className="text-[11px] text-nh-beige/60 underline underline-offset-4">
                Batal
              </button>
            </div>
          </div>
        ))}
      {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}
    </div>
  );
}
