"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

/**
 * Pindah jadwal sesi Personal Training dari Coach Portal (EPIC-067 T-067-A7):
 * pilih tanggal → jam kosong coach sendiri → alasan opsional. Kredit member
 * tetap; member dikabari WA dan boleh batal tanpa penalti.
 */

// nh-dark-input: penawar aturan global input terang di globals.css.
const inputClass = "nh-dark-input w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition [color-scheme:dark]";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

export function CoachPtReschedule({
  bookingId,
  sessionDate,
  startTime,
  today,
  onDone,
}: {
  bookingId: string;
  sessionDate: string;
  startTime: string;
  today: string;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(sessionDate >= today ? sessionDate : today);
  const [slots, setSlots] = useState<{ key: string; list?: string[]; error?: string } | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = `${bookingId}|${date}`;

  useEffect(() => {
    if (!open || !date) return;
    let cancelled = false;
    requestJson<{ data: string[] }>(`/api/coach/pt/slots?booking_id=${bookingId}&date=${date}`)
      .then((r) => !cancelled && setSlots({ key, list: r.data.filter((t) => !(date === sessionDate && t === startTime)) }))
      .catch((e) => !cancelled && setSlots({ key, error: e instanceof Error ? e.message : "Gagal memuat jam" }));
    return () => {
      cancelled = true;
    };
  }, [open, date, key, bookingId, sessionDate, startTime]);

  const current = slots && slots.key === key ? slots : null;

  async function submit() {
    if (!time) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await requestJson<{ message: string }>(`/api/coach/pt/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, start_time: time, reason: reason.trim() || null }),
      });
      setOpen(false);
      onDone(r.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memindah");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-nh-lime underline underline-offset-4"
      >
        <CalendarClock className="size-3.5" /> Pindah jadwal
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-nh-beige/70">Pindah ke jam kosong Anda. Kredit member tetap; member dikabari WA dan boleh batal tanpa penalti.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-nh-beige/80">Tanggal baru</span>
        <input
          type="date"
          className={inputClass}
          min={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setTime(null);
          }}
        />
      </label>
      {!current ? (
        <Loader2 className="mx-auto size-4 animate-spin text-nh-lime" />
      ) : current.error ? (
        <p className="text-xs text-red-300">{current.error}</p>
      ) : current.list!.length === 0 ? (
        <p className="text-xs text-nh-beige/60">Tidak ada jam kosong di tanggal ini (cek jam ketersediaan atau cuti).</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {current.list!.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTime(t)}
              className={`rounded-lg py-2 text-sm font-semibold tabular-nums ${t === time ? "bg-nh-lime text-nh-forest" : "bg-white/10 text-nh-beige hover:bg-white/15"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <input className={inputClass} placeholder="Alasan (opsional, ikut dikirim ke member)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!time || busy}
          onClick={submit}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-nh-lime py-2 text-sm font-semibold text-nh-forest disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />} {time ? `Pindah ke ${time}` : "Pilih jam"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-4 text-sm text-nh-beige/70">
          Batal
        </button>
      </div>
      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}
