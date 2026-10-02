"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { COACH_LEVEL_LABEL, WEEKDAY_LABELS } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, AvailabilityData, CoachRow, ProgramRow } from "../types";
import { formatDate, initials, todayIso } from "../types";
import { EmptyState, Field, Pill, StudioPageHeader } from "./ui-bits";

type Window = { weekday: number; start_time: string; end_time: string };

export function StudioAvailabilityPage() {
  const [coaches, setCoaches] = useState<CoachRow[] | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [coachId, setCoachId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<ApiList<CoachRow>>("/api/studio/coaches?active=1"),
      apiGet<ApiList<ProgramRow>>("/api/studio/programs?active=1"),
    ])
      .then(([c, p]) => {
        setCoaches(c.data);
        setPrograms(p.data.filter((x) => x.kind === "pt"));
        setCoachId((cur) => cur ?? c.data[0]?.id ?? null);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat coach"));
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Ketersediaan Coach"
        subtitle="Jam mingguan coach menerima Personal Training, program Personal Training yang bisa dilatih, dan cuti. Slot booking dihitung dari sini dikurangi jadwal kelas coach."
      />
      {coaches === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : coaches.length === 0 ? (
        <EmptyState title="Belum ada coach" description="Tambahkan coach dulu di menu Coach." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ul className="space-y-2">
            {coaches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setCoachId(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${c.id === coachId ? "border-nh-forest bg-nh-forest text-nh-beige" : "border-border bg-card hover:border-ring"}`}
                >
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg font-display text-sm font-semibold ${c.id === coachId ? "bg-nh-lime text-nh-forest" : "bg-nh-forest text-nh-lime"}`}>
                    {initials(c.full_name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.display_name || c.full_name}</span>
                    <span className={`text-xs ${c.id === coachId ? "text-nh-beige/70" : "text-muted-foreground"}`}>{COACH_LEVEL_LABEL[c.level]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {coachId && <CoachAvailabilityEditor key={coachId} coachId={coachId} programs={programs} />}
        </div>
      )}
    </div>
  );
}

function CoachAvailabilityEditor({ coachId, programs }: { coachId: string; programs: ProgramRow[] }) {
  const [windows, setWindows] = useState<Window[] | null>(null);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [timeOff, setTimeOff] = useState<AvailabilityData["time_off"]>([]);
  const [saving, setSaving] = useState(false);
  const [off, setOff] = useState({ date_from: todayIso(), date_to: todayIso(), reason: "" });

  const load = useCallback(async () => {
    const res = await apiGet<{ data: AvailabilityData }>(`/api/studio/availability/${coachId}`);
    setWindows(res.data.windows.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time })));
    setProgramIds(res.data.program_ids);
    setTimeOff(res.data.time_off);
  }, [coachId]);

  useEffect(() => {
    load().catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat ketersediaan"));
  }, [load]);

  if (!windows) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const update = (i: number, patch: Partial<Window>) => setWindows((ws) => ws!.map((w, k) => (k === i ? { ...w, ...patch } : w)));

  async function save() {
    setSaving(true);
    try {
      const res = await apiPut<ApiMessage>(`/api/studio/availability/${coachId}`, { windows, program_ids: programIds });
      toast.success(res.message ?? "Tersimpan");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  async function addTimeOff() {
    try {
      const res = await apiPost<ApiMessage>(`/api/studio/availability/${coachId}/time-off`, { ...off, reason: off.reason.trim() || null });
      toast.success(res.message ?? "Cuti dicatat");
      setOff({ date_from: todayIso(), date_to: todayIso(), reason: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat cuti");
    }
  }

  async function removeTimeOff(id: string) {
    try {
      await apiDelete(`/api/studio/availability/time-off/${id}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus cuti");
    }
  }

  const totalHours = windows.reduce((s, w) => {
    const [sh, sm] = w.start_time.split(":").map(Number);
    const [eh, em] = w.end_time.split(":").map(Number);
    return s + Math.max(eh * 60 + em - (sh * 60 + sm), 0) / 60;
  }, 0);

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-[13px] font-semibold text-foreground">Program Personal Training yang bisa dilatih</p>
        <p className="mb-3 text-xs text-muted-foreground">Coach muncul sebagai pilihan saat member memilih program ini.</p>
        {programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada program berjenis Personal Training. Buat di menu Program Kelas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {programs.map((p) => {
              const on = programIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setProgramIds((ids) => (on ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-nh-forest bg-nh-forest text-nh-lime" : "border-border bg-background text-foreground hover:border-ring"}`}
                >
                  {p.name} · {p.duration_minutes} mnt
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Jam ketersediaan mingguan</p>
            <p className="text-xs text-muted-foreground">Jam kelas grup coach otomatis tidak bisa dibooking walau masuk jendela ini.</p>
          </div>
          <Pill tone="positive">{totalHours.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam / minggu</Pill>
        </div>
        <div className="divide-y divide-border">
          {WEEKDAY_LABELS.map((label, i) => {
            const day = i + 1;
            const items = windows.map((w, idx) => ({ w, idx })).filter((x) => x.w.weekday === day);
            return (
              <div key={label} className="flex flex-wrap items-start gap-3 py-3">
                <span className="w-16 pt-1.5 text-sm font-medium text-foreground">{label}</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {items.length === 0 && <span className="pt-1.5 text-xs text-muted-foreground">Tidak menerima Personal Training</span>}
                  {items.map(({ w, idx }) => (
                    <span key={idx} className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1">
                      <input type="time" value={w.start_time} onChange={(e) => update(idx, { start_time: e.target.value })} className="h-7 w-[7.5rem] rounded border-0 bg-transparent px-1 text-sm tabular-nums" aria-label={`${label} mulai`} />
                      <span className="text-muted-foreground">–</span>
                      <input type="time" value={w.end_time} onChange={(e) => update(idx, { end_time: e.target.value })} className="h-7 w-[7.5rem] rounded border-0 bg-transparent px-1 text-sm tabular-nums" aria-label={`${label} selesai`} />
                      <button type="button" aria-label="Hapus jendela" onClick={() => setWindows((ws) => ws!.filter((_, k) => k !== idx))} className="rounded p-1 text-muted-foreground transition hover:text-destructive">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWindows((ws) => [...ws!, { weekday: day, start_time: "09:00", end_time: "12:00" }])}
                  >
                    <Plus className="size-3.5" /> Jam
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} Simpan ketersediaan
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <CalendarOff className="size-4" /> Cuti / tidak tersedia
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <Field label="Dari">
            <Input type="date" value={off.date_from} onChange={(e) => setOff((o) => ({ ...o, date_from: e.target.value }))} />
          </Field>
          <Field label="Sampai">
            <Input type="date" value={off.date_to} onChange={(e) => setOff((o) => ({ ...o, date_to: e.target.value }))} />
          </Field>
          <Field label="Alasan">
            <Input value={off.reason} onChange={(e) => setOff((o) => ({ ...o, reason: e.target.value }))} placeholder="Mis. lomba, sakit" />
          </Field>
          <Button variant="outline" onClick={addTimeOff}>Catat cuti</Button>
        </div>
        {timeOff.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {timeOff.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-foreground">
                  {formatDate(t.date_from)}
                  {t.date_to !== t.date_from ? ` – ${formatDate(t.date_to)}` : ""}
                  {t.reason ? <span className="text-muted-foreground"> · {t.reason}</span> : null}
                </span>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Hapus cuti" onClick={() => removeTimeOff(t.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
