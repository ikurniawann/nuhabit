"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { toMinutes, WEEKDAY_LABELS } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, CoachRow, ProgramRow, TemplateRow } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type DialogState = { mode: "create"; weekday: number } | { mode: "edit"; row: TemplateRow } | null;

function addMinutes(time: string, minutes: number): string {
  const total = Math.min(toMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function StudioTemplatesPage() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, p, c] = await Promise.all([
        apiGet<ApiList<TemplateRow>>("/api/studio/templates"),
        apiGet<ApiList<ProgramRow>>("/api/studio/programs?active=1"),
        apiGet<ApiList<CoachRow>>("/api/studio/coaches?active=1"),
      ]);
      setRows(t.data);
      setPrograms(p.data);
      setCoaches(c.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat template");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: TemplateRow) {
    if (!confirm(`Hapus slot ${WEEKDAY_LABELS[row.weekday - 1]} ${row.start_time} ${row.program_name}?`)) return;
    try {
      const res = (await apiDelete(`/api/studio/templates/${row.id}`)) as ApiMessage;
      toast.success(res.message ?? "Slot dihapus");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus slot");
    }
  }

  const activeCount = rows?.filter((r) => r.is_active).length ?? 0;
  const noMaster = programs.length === 0;

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Template Mingguan"
        subtitle={`Pola jadwal kelas berulang tiap minggu. ${activeCount} slot aktif per minggu — dipakai saat generate Jadwal Kelas.`}
      />

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : noMaster ? (
        <EmptyState
          title="Buat program kelas dulu"
          description="Template butuh minimal satu program aktif (dan sebaiknya coach) sebelum slot bisa ditambahkan."
          action={<Button onClick={() => (window.location.href = "/dashboard/studio/programs")}>Buka Program Kelas</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {WEEKDAY_LABELS.map((label, i) => {
            const weekday = i + 1;
            const slots = rows.filter((r) => r.weekday === weekday);
            return (
              <section key={label} className="flex min-h-48 flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
                <header className="mb-2 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-sm font-semibold text-foreground">{label}</h2>
                    <p className="text-xs text-muted-foreground">{slots.filter((s) => s.is_active).length} kelas</p>
                  </div>
                  <div className="flex gap-0.5">
                    {slots.length > 0 && (
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Salin slot ${label}`} onClick={() => setCopyFrom(weekday)}>
                        <Copy className="size-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Tambah slot ${label}`} onClick={() => setDialog({ mode: "create", weekday })}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </header>
                <div className="flex flex-1 flex-col gap-2">
                  {slots.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Libur / belum ada kelas</p>}
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDialog({ mode: "edit", row: s })}
                      className={`rounded-lg border px-2.5 py-2 text-left transition hover:border-ring ${
                        s.is_active ? "border-border bg-background" : "border-dashed border-border bg-muted/50 opacity-70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                        <span className="whitespace-nowrap font-semibold text-foreground">{s.start_time}–{s.end_time}</span>
                        <span className="shrink-0 text-muted-foreground">{s.capacity}</span>
                      </div>
                      <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{s.program_name}</div>
                      <div className={`mt-0.5 truncate text-xs ${s.coach_name ? "text-muted-foreground" : "font-semibold text-destructive"}`}>
                        {s.coach_name ?? "Belum ada coach"}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {dialog && (
        <TemplateDialog
          state={dialog}
          programs={programs}
          coaches={coaches}
          onClose={() => setDialog(null)}
          onRemove={(row) => {
            setDialog(null);
            void remove(row);
          }}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}

      {copyFrom !== null && rows && (
        <CopyDayDialog
          fromWeekday={copyFrom}
          slots={rows.filter((r) => r.weekday === copyFrom)}
          onClose={() => setCopyFrom(null)}
          onDone={() => {
            setCopyFrom(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  state,
  programs,
  coaches,
  onClose,
  onSaved,
  onRemove,
}: {
  state: NonNullable<DialogState>;
  programs: ProgramRow[];
  coaches: CoachRow[];
  onClose: () => void;
  onSaved: () => void;
  onRemove: (row: TemplateRow) => void;
}) {
  const initial = state.mode === "edit" ? state.row : null;
  const firstProgram = programs.find((p) => p.kind === "class") ?? programs[0];
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    weekday: initial?.weekday ?? (state.mode === "create" ? state.weekday : 1),
    program_id: initial?.program_id ?? firstProgram?.id ?? "",
    start_time: initial?.start_time ?? "17:00",
    end_time: initial?.end_time ?? addMinutes("17:00", firstProgram?.duration_minutes ?? 60),
    coach_id: initial?.coach_id ?? "",
    capacity: String(initial?.capacity ?? firstProgram?.default_capacity ?? 12),
    notes: initial?.notes ?? "",
    is_active: initial?.is_active ?? true,
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

  function pickStart(value: string) {
    const p = programs.find((x) => x.id === form.program_id);
    setForm((f) => ({ ...f, start_time: value, end_time: p && value ? addMinutes(value, p.duration_minutes) : f.end_time }));
  }

  async function save() {
    setBusy(true);
    const payload = {
      weekday: Number(form.weekday),
      program_id: form.program_id,
      start_time: form.start_time,
      end_time: form.end_time,
      coach_id: form.coach_id || null,
      capacity: Number(form.capacity) || undefined,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };
    try {
      const res = initial
        ? await apiPatch<ApiMessage>(`/api/studio/templates/${initial.id}`, payload)
        : await apiPost<ApiMessage>("/api/studio/templates", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan slot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Ubah slot template" : `Slot baru — ${WEEKDAY_LABELS[form.weekday - 1]}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hari">
            <NativeSelect value={form.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
              {WEEKDAY_LABELS.map((l, i) => (
                <option key={l} value={i + 1}>{l}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Program">
            <NativeSelect value={form.program_id} onChange={(e) => pickProgram(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Mulai">
            <Input type="time" value={form.start_time} onChange={(e) => pickStart(e.target.value)} />
          </Field>
          <Field label="Selesai">
            <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </Field>
          <Field label="Coach">
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
          <Field label="Catatan" className="sm:col-span-2">
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
            <span className="text-sm text-foreground">Aktif (ikut di-generate)</span>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Aktif" />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {initial ? (
            <Button variant="destructive" onClick={() => onRemove(initial)} disabled={busy}>
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

function CopyDayDialog({
  fromWeekday,
  slots,
  onClose,
  onDone,
}: {
  fromWeekday: number;
  slots: TemplateRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const weekday of targets) {
      for (const s of slots) {
        try {
          await apiPost("/api/studio/templates", {
            weekday,
            program_id: s.program_id,
            start_time: s.start_time,
            end_time: s.end_time,
            coach_id: s.coach_id,
            capacity: s.capacity,
            notes: s.notes,
            is_active: s.is_active,
          });
          ok++;
        } catch (e) {
          failures.push(`${WEEKDAY_LABELS[weekday - 1]} ${s.start_time}: ${e instanceof Error ? e.message : "gagal"}`);
        }
      }
    }
    setBusy(false);
    if (ok) toast.success(`${ok} slot disalin`);
    if (failures.length) toast.error(`${failures.length} slot dilewati`, { description: failures.slice(0, 4).join("\n") });
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salin {slots.length} slot {WEEKDAY_LABELS[fromWeekday - 1]}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pilih hari tujuan. Slot yang membuat coach bentrok di hari tujuan akan dilewati.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {WEEKDAY_LABELS.map((label, i) => {
            const day = i + 1;
            if (day === fromWeekday) return null;
            const on = targets.includes(day);
            return (
              <button
                key={label}
                type="button"
                onClick={() => setTargets((t) => (on ? t.filter((x) => x !== day) : [...t, day]))}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  on ? "border-nh-forest bg-nh-forest text-nh-lime" : "border-border bg-card text-foreground hover:border-ring"
                }`}
                aria-pressed={on}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Pill>{targets.length * slots.length} slot akan dibuat</Pill>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={run} disabled={busy || targets.length === 0}>
              {busy && <Loader2 className="size-4 animate-spin" />} Salin
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
