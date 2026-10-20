"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT } from "@/features/gym/shared";
import { dayStart, tanggal, WEEKDAYS } from "@/features/gym/scheduling/api";
import { localDay, zoneAbbr } from "@/lib/timezone";
import { COACHING_KEYS, coachingApi, type Availability, type ExceptionInput, type PtCoach, type Window } from "../api";

/** Ketersediaan PT per coach: jendela mingguan dan pengecualian per tanggal. */
export function AvailabilityPanel({ coaches }: { coaches: PtCoach[] }) {
  const [chosen, setChosen] = useState("");
  const coachId = chosen || coaches[0]?.id || "";
  const availability = useQuery({
    queryKey: COACHING_KEYS.availability(coachId),
    queryFn: () => coachingApi.availability(coachId),
    enabled: Boolean(coachId),
  });

  if (coaches.length === 0) {
    return (
      <Card>
        <TableNote>Belum ada coach aktif, atau akun ini belum terhubung ke coach.</TableNote>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {coaches.length > 1 && (
        <Field label="Coach" className="max-w-sm">
          <select className={SELECT} value={coachId} onChange={(e) => setChosen(e.target.value)}>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {availability.isLoading ? (
        <Card>
          <TableNote>Memuat ketersediaan…</TableNote>
        </Card>
      ) : availability.error || !availability.data ? (
        <Card>
          <TableNote tone="danger">{availability.error?.message ?? "Ketersediaan gagal dimuat"}</TableNote>
        </Card>
      ) : (
        <>
          <WeeklyEditor key={coachId} availability={availability.data} />
          <ExceptionsCard availability={availability.data} />
        </>
      )}
    </div>
  );
}

function WeeklyEditor({ availability }: { availability: Availability }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Window[]>(availability.weekly);
  const save = useMutation({
    mutationFn: () => coachingApi.setWeekly(availability.coach_id, rows),
    onSuccess: (data) => {
      queryClient.setQueryData(COACHING_KEYS.availability(availability.coach_id), data);
      void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.slots });
      toast.success("Jadwal mingguan disimpan");
    },
    onError: (error) => toast.error("Jadwal gagal disimpan", { description: error.message }),
  });
  const update = (i: number, patch: Partial<Window>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = rows.every((r) => /^\d{2}:\d{2}$/.test(r.start_time) && /^\d{2}:\d{2}$/.test(r.end_time) && r.end_time > r.start_time);

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Jam PT mingguan</h2>
          <p className="text-xs text-muted-foreground">
            Jam {zoneAbbr(availability.timezone)}, zona cabang coach. Member hanya bisa meminta sesi di jam ini. Jam yang bentrok
            dengan kelas grup coach otomatis tidak ditawarkan.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows((cur) => [...cur, { weekday: 1, start_time: "07:00", end_time: "11:00" }])}
        >
          <Plus /> Tambah jam
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada jam PT. Coach ini belum tampil di aplikasi member.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows
            .map((r, i) => ({ r, i }))
            .sort((a, b) => a.r.weekday - b.r.weekday || a.r.start_time.localeCompare(b.r.start_time))
            .map(({ r, i }) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[12rem_8rem_8rem_auto]">
                <select
                  className={`${SELECT} col-span-2 sm:col-span-1`}
                  value={r.weekday}
                  aria-label="Hari"
                  onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d, idx) => (
                    <option key={d} value={idx + 1}>
                      {d}
                    </option>
                  ))}
                </select>
                <div className="col-span-2 flex items-center gap-2 sm:contents">
                  <Input type="time" aria-label="Jam mulai" value={r.start_time} onChange={(e) => update(i, { start_time: e.target.value })} />
                  <Input type="time" aria-label="Jam selesai" value={r.end_time} onChange={(e) => update(i, { end_time: e.target.value })} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Hapus jam"
                    onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
          Simpan jadwal mingguan
        </Button>
      </div>
    </Card>
  );
}

function ExceptionsCard({ availability }: { availability: Availability }) {
  const queryClient = useQueryClient();
  const today = localDay(new Date(), availability.timezone);
  const empty: ExceptionInput = { date: today, kind: "off", start_time: null, end_time: null, note: "" };
  const [form, setForm] = useState(empty);
  const [allDay, setAllDay] = useState(true);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.availability(availability.coach_id) });
    void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.slots });
  };
  const add = useMutation({
    mutationFn: () =>
      coachingApi.addException(availability.coach_id, {
        ...form,
        start_time: allDay && form.kind === "off" ? null : form.start_time,
        end_time: allDay && form.kind === "off" ? null : form.end_time,
        note: form.note.trim(),
      }),
    onSuccess: () => {
      setForm(empty);
      setAllDay(true);
      refresh();
      toast.success("Pengecualian disimpan");
    },
    onError: (error) => toast.error("Pengecualian gagal disimpan", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: coachingApi.deleteException,
    onSuccess: refresh,
    onError: (error) => toast.error("Pengecualian gagal dihapus", { description: error.message }),
  });
  const timed = form.kind === "extra" || !allDay;

  return (
    <Card className="gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Libur dan jam tambahan</h2>
        <p className="text-xs text-muted-foreground">Berlaku untuk satu tanggal saja. Sesi yang sudah dibooking tidak berubah.</p>
      </div>
      {availability.exceptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada pengecualian mendatang.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {availability.exceptions.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">{tanggal(dayStart(x.date))}</span>
                <Badge variant={x.kind === "off" ? "warning" : "success"}>{x.kind === "off" ? "Libur" : "Jam tambahan"}</Badge>
                <span className="tabular-nums">{x.start_time ? `${x.start_time}–${x.end_time}` : "Seharian"}</span>
                {x.note && <span className="text-muted-foreground">{x.note}</span>}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Hapus pengecualian"
                disabled={remove.isPending}
                onClick={() => remove.mutate(x.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Tanggal">
          <Input type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </Field>
        <Field label="Jenis">
          <select
            className={SELECT}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ExceptionInput["kind"] })}
          >
            <option value="off">Libur</option>
            <option value="extra">Jam tambahan</option>
          </select>
        </Field>
        {timed ? (
          <>
            <Field label="Mulai">
              <Input type="time" value={form.start_time ?? ""} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
            </Field>
            <Field label="Selesai">
              <Input type="time" value={form.end_time ?? ""} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
            </Field>
          </>
        ) : (
          <div className="sm:col-span-2" />
        )}
        {form.kind === "off" && (
          <label className="flex items-center gap-2 text-sm sm:col-span-4">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Libur seharian
          </label>
        )}
        <Field label="Catatan" className="sm:col-span-3">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} placeholder="Opsional" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="outline" className="w-full" disabled={add.isPending}>
            <Plus /> Tambah
          </Button>
        </div>
      </form>
    </Card>
  );
}
