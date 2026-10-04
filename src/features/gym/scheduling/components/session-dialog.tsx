"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GYM_KEYS, schedulingApi, type Session, wibDay, wibTime } from "../api";
import { SELECT } from "@/features/gym/shared";

/**
 * Buat sesi baru (date = hari awal, "YYYY-MM-DD") atau ubah sesi yang ada.
 * Kosongkan kapasitas/kredit/durasi untuk memakai default jenis kelas.
 */
export function SessionDialog({
  session,
  date,
  onClose,
  onSaved,
}: {
  session?: Session | null;
  date?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const classTypes = useQuery({ queryKey: GYM_KEYS.classTypes, queryFn: schedulingApi.classTypes });
  const coaches = useQuery({ queryKey: GYM_KEYS.coaches, queryFn: schedulingApi.coaches });
  const editing = Boolean(session);
  const [form, setForm] = useState(() => ({
    class_type_id: session?.class_type_id ?? "",
    coach_id: session?.coach_id ?? "",
    day: session ? wibDay(session.starts_at) : (date ?? wibDay(new Date())),
    time: session ? wibTime(session.starts_at) : "18:30",
    area: session?.area ?? "Main Floor",
    duration_min: session
      ? String(Math.round((Date.parse(session.ends_at) - Date.parse(session.starts_at)) / 60_000))
      : "",
    capacity: session ? String(session.capacity) : "",
    credit_cost: session ? String(session.credit_cost) : "",
    notes: session?.notes ?? "",
  }));
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const activeTypes = (classTypes.data ?? []).filter((t) => t.status === "active");
  const chosenType = activeTypes.find((t) => t.id === form.class_type_id);
  const num = (value: string) => (value.trim() ? Number(value) : null);
  const startsAt = new Date(`${form.day}T${form.time}:00+07:00`).toISOString();

  const save = useMutation({
    mutationFn: (publish: boolean) =>
      session
        ? schedulingApi.updateSession(session.id, {
            coach_id: form.coach_id || null,
            area: form.area.trim() || null,
            starts_at: startsAt,
            duration_min: num(form.duration_min) ?? undefined,
            capacity: num(form.capacity) ?? undefined,
            notes: form.notes.trim() || null,
          })
        : schedulingApi.createSession({
            class_type_id: form.class_type_id,
            coach_id: form.coach_id || null,
            area: form.area.trim() || null,
            starts_at: startsAt,
            duration_min: num(form.duration_min),
            capacity: num(form.capacity),
            credit_cost: num(form.credit_cost),
            notes: form.notes.trim() || null,
            publish,
          }),
    onSuccess: (_data, publish) => {
      toast.success(editing ? "Sesi diperbarui" : publish ? "Sesi diterbitkan" : "Draf sesi disimpan");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Sesi gagal disimpan", { description: error.message }),
  });

  const valid = (editing || Boolean(form.class_type_id)) && /^\d{4}-\d{2}-\d{2}$/.test(form.day) && /^\d{2}:\d{2}$/.test(form.time);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(true);
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{session ? `Ubah ${session.class_type_name}` : "Sesi kelas baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              {editing
                ? "Memindah jam mengabari member yang sudah booking. Kapasitas tidak bisa di bawah jumlah terdaftar."
                : "Kosongkan kapasitas, kredit, dan durasi untuk memakai default jenis kelas. Jendela booking mengikuti aturan gym."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Jenis kelas" className="sm:col-span-2">
              <select
                className={SELECT}
                value={form.class_type_id}
                onChange={set("class_type_id")}
                disabled={editing}
                required
              >
                <option value="">Pilih jenis kelas</option>
                {(editing ? classTypes.data ?? [] : activeTypes).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.default_duration_min} mnt · {t.default_credit_cost} kredit
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Coach">
              <select className={SELECT} value={form.coach_id} onChange={set("coach_id")}>
                <option value="">Belum ditentukan</option>
                {(coaches.data ?? [])
                  .filter((c) => c.status === "active" || c.id === form.coach_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Area">
              <Input value={form.area} onChange={set("area")} placeholder="Main Floor" />
            </Field>
            <Field label="Tanggal">
              <Input type="date" value={form.day} onChange={set("day")} required />
            </Field>
            <Field label="Jam mulai (WIB)">
              <Input type="time" value={form.time} onChange={set("time")} required />
            </Field>
            <Field label="Durasi (menit)">
              <Input
                type="number"
                min={15}
                value={form.duration_min}
                onChange={set("duration_min")}
                placeholder={chosenType ? String(chosenType.default_duration_min) : "default"}
              />
            </Field>
            <Field label="Kapasitas" hint="Booking setelah penuh masuk waitlist.">
              <Input
                type="number"
                min={1}
                value={form.capacity}
                onChange={set("capacity")}
                placeholder={chosenType ? String(chosenType.default_capacity) : "default"}
              />
            </Field>
            {!editing && (
              <Field label="Biaya kredit" hint="Dipotong saat check-in, bukan saat booking.">
                <Input
                  type="number"
                  min={1}
                  value={form.credit_cost}
                  onChange={set("credit_cost")}
                  placeholder={chosenType ? String(chosenType.default_credit_cost) : "default"}
                />
              </Field>
            )}
            <Field label="Catatan" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.notes} onChange={set("notes")} />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            {!editing && (
              <Button type="button" variant="outline" onClick={() => save.mutate(false)} disabled={!valid || save.isPending}>
                Simpan draf
              </Button>
            )}
            <Button type="submit" disabled={!valid || save.isPending}>
              {editing ? "Simpan perubahan" : "Terbitkan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
