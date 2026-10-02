"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { addDays, SESSION_STATUS_LABEL, startOfWeek, toMinutes, type SessionStatus } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, CoachRow, ProgramRow, SessionRow } from "../types";
import { formatDayLabel, todayIso } from "../types";
import { Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type DialogState = { mode: "create"; date: string } | { mode: "edit"; row: SessionRow } | null;

function addMinutes(time: string, minutes: number): string {
  const total = Math.min(toMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function weekRangeLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const fmt = (d: string, withYear: boolean) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return `${fmt(monday, false)} – ${fmt(sunday, true)}`;
}

export function StudioSchedulePage() {
  const today = todayIso();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const [monday, setMonday] = useState(() =>
    startOfWeek(weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : today)
  );
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const res = await apiGet<ApiList<SessionRow>>(`/api/studio/sessions?from=${monday}&to=${addDays(monday, 6)}`);
      setRows(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat jadwal");
      setRows([]);
    }
  }, [monday]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      apiGet<ApiList<ProgramRow>>("/api/studio/programs?active=1"),
      apiGet<ApiList<CoachRow>>("/api/studio/coaches?active=1"),
    ])
      .then(([p, c]) => {
        setPrograms(p.data);
        setCoaches(c.data);
      })
      .catch(() => undefined);
  }, []);

  const active = rows?.filter((r) => r.status !== "cancelled") ?? [];
  const unassigned = active.filter((r) => !r.coach_id).length;
  const seats = active.reduce((sum, r) => sum + r.capacity, 0);

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Jadwal Kelas"
        subtitle="Jadwal nyata per tanggal. Ganti coach, ubah kuota, atau batalkan per sesi tanpa mengubah template."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowGenerate(true)}>
              <Sparkles className="size-4" /> Generate dari template
            </Button>
            <Button onClick={() => setDialog({ mode: "create", date: days.includes(today) ? today : monday })}>
              <Plus className="size-4" /> Sesi khusus
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Minggu sebelumnya" onClick={() => setMonday(addDays(monday, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setMonday(startOfWeek(today))}>Minggu ini</Button>
          <Button variant="outline" size="icon" aria-label="Minggu berikutnya" onClick={() => setMonday(addDays(monday, 7))}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 font-display text-base font-semibold text-foreground">{weekRangeLabel(monday)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="positive">{active.length} kelas</Pill>
          <Pill>{seats} kursi</Pill>
          {unassigned > 0 && <Pill tone="warning">{unassigned} tanpa coach</Pill>}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((date) => {
            const list = rows.filter((r) => r.session_date === date);
            const isToday = date === today;
            return (
              <section
                key={date}
                className={`flex min-h-56 flex-col rounded-xl border bg-card p-3 shadow-sm ${isToday ? "border-nh-forest ring-1 ring-nh-forest/30" : "border-border"}`}
              >
                <header className="mb-2 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-sm font-semibold capitalize text-foreground">{formatDayLabel(date)}</h2>
                    <p className="text-xs text-muted-foreground">
                      {isToday ? "Hari ini · " : ""}
                      {list.filter((s) => s.status !== "cancelled").length} kelas
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Tambah sesi ${date}`} onClick={() => setDialog({ mode: "create", date })}>
                    <CalendarPlus className="size-4" />
                  </Button>
                </header>
                <div className="flex flex-1 flex-col gap-2">
                  {list.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Tidak ada kelas</p>}
                  {list.map((s) => (
                    <SessionCard key={s.id} s={s} onClick={() => setDialog({ mode: "edit", row: s })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Minggu ini belum punya jadwal. Klik <strong>Generate dari template</strong> untuk membentuk kelas dari Template Mingguan.
        </p>
      )}

      {showGenerate && (
        <GenerateDialog
          defaultFrom={monday < today ? today : monday}
          onClose={() => setShowGenerate(false)}
          onDone={() => {
            setShowGenerate(false);
            void load();
          }}
        />
      )}

      {dialog && (
        <SessionDialog
          state={dialog}
          programs={programs}
          coaches={coaches}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function SessionCard({ s, onClick }: { s: SessionRow; onClick: () => void }) {
  const cancelled = s.status === "cancelled";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-2 text-left transition hover:border-ring ${
        cancelled ? "border-dashed border-border bg-muted/50 opacity-70" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`whitespace-nowrap text-xs font-semibold tabular-nums text-foreground ${cancelled ? "line-through" : ""}`}>
          {s.start_time}–{s.end_time}
        </span>
        {s.status !== "scheduled" && (
          <Pill tone={cancelled ? "danger" : "positive"} className="px-1.5 py-0 text-[10px]">
            {SESSION_STATUS_LABEL[s.status]}
          </Pill>
        )}
        {!s.template_id && s.status === "scheduled" && <Pill className="px-1.5 py-0 text-[10px]">Khusus</Pill>}
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{s.program_name}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className={`truncate ${s.coach_id ? "text-muted-foreground" : "font-semibold text-destructive"}`}>{s.coach_name ?? "Tanpa coach"}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{s.booked_count ?? 0}/{s.capacity}</span>
      </div>
    </button>
  );
}

function GenerateDialog({ defaultFrom, onClose, onDone }: { defaultFrom: string; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(addDays(startOfWeek(defaultFrom), 27));
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/sessions/generate", { from, to, skip_holidays: skipHolidays });
      toast.success(res.message ?? "Jadwal dibentuk");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal generate jadwal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate jadwal dari template</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Membentuk sesi kelas dari Template Mingguan. Aman dijalankan ulang: sesi yang sudah ada tidak diduplikasi. Maksimal 62 hari sekali jalan.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dari tanggal">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Sampai tanggal">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
            <span className="text-sm text-foreground">Lewati hari libur nasional</span>
            <Switch checked={skipHolidays} onCheckedChange={setSkipHolidays} aria-label="Lewati hari libur nasional" />
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={run} disabled={busy || !from || !to}>
            {busy && <Loader2 className="size-4 animate-spin" />} Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionDialog({
  state,
  programs,
  coaches,
  onClose,
  onSaved,
}: {
  state: NonNullable<DialogState>;
  programs: ProgramRow[];
  coaches: CoachRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = state.mode === "edit" ? state.row : null;
  const firstProgram = programs.find((p) => p.kind === "class") ?? programs[0];
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    session_date: initial?.session_date ?? (state.mode === "create" ? state.date : todayIso()),
    program_id: initial?.program_id ?? firstProgram?.id ?? "",
    start_time: initial?.start_time ?? "17:00",
    end_time: initial?.end_time ?? addMinutes("17:00", firstProgram?.duration_minutes ?? 60),
    coach_id: initial?.coach_id ?? "",
    capacity: String(initial?.capacity ?? firstProgram?.default_capacity ?? 12),
    status: (initial?.status ?? "scheduled") as SessionStatus,
    cancel_reason: initial?.cancel_reason ?? "",
    notes: initial?.notes ?? "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function pickProgram(id: string) {
    const p = programs.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      program_id: id,
      end_time: p ? addMinutes(f.start_time, p.duration_minutes) : f.end_time,
      capacity: initial ? f.capacity : String(p?.default_capacity ?? f.capacity),
    }));
  }

  async function save() {
    setBusy(true);
    const payload = {
      session_date: form.session_date,
      program_id: form.program_id,
      start_time: form.start_time,
      end_time: form.end_time,
      coach_id: form.coach_id || null,
      capacity: Number(form.capacity) || undefined,
      status: form.status,
      cancel_reason: form.status === "cancelled" ? form.cancel_reason.trim() || null : null,
      notes: form.notes.trim() || null,
    };
    try {
      const res = initial
        ? await apiPatch<ApiMessage>(`/api/studio/sessions/${initial.id}`, payload)
        : await apiPost<ApiMessage>("/api/studio/sessions", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan sesi");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !confirm("Hapus sesi ini? Gunakan Batalkan bila ingin jejaknya tetap tercatat.")) return;
    setBusy(true);
    try {
      const res = (await apiDelete(`/api/studio/sessions/${initial.id}`)) as ApiMessage;
      toast.success(res.message ?? "Sesi dihapus");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus sesi");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `${initial.program_name} · ${formatDayLabel(initial.session_date)}` : "Sesi khusus"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tanggal">
            <Input type="date" value={form.session_date} onChange={(e) => set("session_date", e.target.value)} />
          </Field>
          <Field label="Program">
            <NativeSelect value={form.program_id} onChange={(e) => pickProgram(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Mulai">
            <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
          </Field>
          <Field label="Selesai">
            <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </Field>
          <Field label="Coach" hint={initial?.template_id ? "Ganti di sini untuk coach pengganti sesi ini saja" : undefined}>
            <NativeSelect value={form.coach_id} onChange={(e) => set("coach_id", e.target.value)}>
              <option value="">— Belum ditentukan —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}{c.level === "head_coach" ? " (Head Coach)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Kuota">
            <Input type="number" min={1} max={200} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          {initial && (
            <Field label="Status" className="sm:col-span-2">
              <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value as SessionStatus)}>
                <option value="scheduled">Terjadwal</option>
                <option value="completed">Selesai</option>
                <option value="cancelled">Dibatalkan</option>
              </NativeSelect>
            </Field>
          )}
          {form.status === "cancelled" && (
            <Field label="Alasan pembatalan" className="sm:col-span-2">
              <Input value={form.cancel_reason} onChange={(e) => set("cancel_reason", e.target.value)} placeholder="Mis. coach sakit, venue maintenance" />
            </Field>
          )}
          <Field label="Catatan" className="sm:col-span-2">
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {initial ? (
            <Button variant="destructive" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" /> Hapus
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={save} disabled={busy || !form.program_id}>
              {busy && <Loader2 className="size-4 animate-spin" />} Simpan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
