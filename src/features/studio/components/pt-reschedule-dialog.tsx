"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api-client";
import type { RescheduleHistoryRow } from "@/lib/studio/pt-reschedule-server";
import type { PtCoach, PtProgram, PtSessionRow } from "../types";
import { formatDayLabel, todayIso } from "../types";
import { Field, NativeSelect } from "./ui-bits";

/**
 * Jadwal ulang Personal Training dari backoffice (EPIC-067 T-067-A7): pilih
 * tanggal, coach (boleh ganti), dan jam kosong. Sesi dipindah di tempat —
 * kredit member tetap; member & coach dikabari WA.
 */

const ACTOR_LABEL: Record<RescheduleHistoryRow["actor_kind"], string> = { member: "Member", coach: "Coach", staff: "Studio" };

export function PtRescheduleDialog({ row, onClose, onDone }: { row: PtSessionRow; onClose: () => void; onDone: () => void }) {
  const [coaches, setCoaches] = useState<PtCoach[] | null>(null);
  const [history, setHistory] = useState<RescheduleHistoryRow[] | null>(null);
  const [date, setDate] = useState(row.session_date >= todayIso() ? row.session_date : todayIso());
  const [coachId, setCoachId] = useState(row.coach_id ?? "");
  const [slots, setSlots] = useState<{ key: string; list: string[] } | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const key = `${date}|${coachId}`;

  useEffect(() => {
    apiGet<{ data: PtProgram[] }>("/api/studio/pt/catalog")
      .then((r) => setCoaches(r.data.find((p) => p.id === row.program_id)?.coaches ?? []))
      .catch(() => setCoaches([]));
    apiGet<{ data: RescheduleHistoryRow[] }>(`/api/studio/pt/bookings/${row.booking_id}/reschedule`)
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]));
  }, [row.program_id, row.booking_id]);

  useEffect(() => {
    if (!date || !coachId) return;
    let cancelled = false;
    apiGet<{ data: { slots: string[] }[] }>(
      `/api/studio/pt/slots?program_id=${row.program_id}&date=${date}&coach_id=${coachId}&exclude_session_id=${row.session_id}`
    )
      .then((r) => {
        if (cancelled) return;
        const same = date === row.session_date && coachId === row.coach_id;
        setSlots({ key, list: (r.data[0]?.slots ?? []).filter((t) => !(same && t === row.start_time)) });
      })
      .catch(() => !cancelled && setSlots({ key, list: [] }));
    return () => {
      cancelled = true;
    };
  }, [key, date, coachId, row.program_id, row.session_id, row.session_date, row.coach_id, row.start_time]);

  const current = slots && slots.key === key ? slots.list : null;

  async function submit() {
    if (!time) return;
    setBusy(true);
    try {
      const r = await apiPost<{ message?: string }>(`/api/studio/pt/bookings/${row.booking_id}/reschedule`, {
        date,
        start_time: time,
        coach_id: coachId !== row.coach_id ? coachId : null,
        reason: reason.trim() || null,
      });
      toast.success(r.message ?? "Jadwal dipindah");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memindah jadwal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Jadwal ulang Personal Training</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {row.member_name ?? "Member"} · {row.program_name} · sekarang {formatDayLabel(row.session_date)} {row.start_time}
          {row.coach_name ? ` dengan ${row.coach_name}` : ""}. Kredit tidak berubah; member & coach dikabari WA, dan member boleh batal tanpa penalti.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal baru">
            <Input type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setTime(null); }} />
          </Field>
          <Field label="Coach">
            <NativeSelect value={coachId} onChange={(e) => { setCoachId(e.target.value); setTime(null); }} aria-label="Coach">
              {!coaches && <option value={coachId}>{row.coach_name ?? "—"}</option>}
              {coaches?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name || c.full_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Jam kosong</p>
          {!current ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : current.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada jam kosong — coba tanggal atau coach lain.</p>
          ) : (
            <div className="grid grid-cols-5 gap-1.5">
              {current.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={t === time}
                  onClick={() => setTime(t)}
                  className={`rounded-md border py-1.5 text-sm tabular-nums ${t === time ? "border-nh-forest bg-nh-forest text-nh-lime" : "border-border hover:bg-secondary"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Alasan (opsional)" hint="Ikut dikirim ke member dan coach.">
          <Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: coach ada jadwal event" />
        </Field>
        {history && history.length > 0 && (
          <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Riwayat jadwal ulang</p>
            <ul className="space-y-0.5">
              {history.map((h) => (
                <li key={h.id}>
                  {ACTOR_LABEL[h.actor_kind]}
                  {h.actor_name ? ` (${h.actor_name})` : ""}: {formatDayLabel(h.from_date)} {h.from_start} → {formatDayLabel(h.to_date)} {h.to_start}
                  {h.reason ? ` · ${h.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!time || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} {time ? `Pindah ke ${formatDayLabel(date)} ${time}` : "Pilih jam"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
