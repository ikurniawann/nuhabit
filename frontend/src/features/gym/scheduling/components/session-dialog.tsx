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
import { localClock, localDay, localInstant, zoneAbbr } from "@/lib/timezone";
import { GYM_KEYS, schedulingApi, type Session } from "../api";
import { SELECT } from "@/features/gym/shared";
import { defaultBranchId, useGymBranches } from "@/features/gym/branches";

/**
 * Buat sesi baru (date = hari awal, "YYYY-MM-DD") atau ubah sesi yang ada.
 * Kosongkan kapasitas/kredit/durasi untuk memakai default jenis kelas.
 * Jenis kelas dan biaya kredit hanya bisa diubah selama belum ada booking;
 * cabang hanya selama sesi belum pernah dibooking (booking batal ikut dihitung).
 */
export function SessionDialog({
  session,
  date,
  hasAnyBooking = false,
  onClose,
  onSaved,
}: {
  session?: Session | null;
  date?: string;
  /** Roster sesi tidak kosong, termasuk booking yang dibatalkan. */
  hasAnyBooking?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const classTypes = useQuery({ queryKey: GYM_KEYS.classTypes, queryFn: schedulingApi.classTypes });
  const coaches = useQuery({ queryKey: GYM_KEYS.coaches, queryFn: schedulingApi.coaches });
  const branches = useGymBranches();
  const editing = Boolean(session);
  const hasBookings = Boolean(session && (session.confirmed_count > 0 || session.waitlist_count > 0));
  const branchLocked = hasBookings || hasAnyBooking;
  // null = belum dipilih: sesi baru ikut cabang staf begitu daftar cabang termuat.
  const [chosenBranch, setChosenBranch] = useState<string | null>(session ? (session.branch_id ?? "") : null);
  const branchId = chosenBranch ?? defaultBranchId(branches.data);
  const [form, setForm] = useState(() => ({
    class_type_id: session?.class_type_id ?? "",
    coach_id: session?.coach_id ?? "",
    day: session ? localDay(session.starts_at, session.timezone) : (date ?? localDay(new Date())),
    time: session ? localClock(session.starts_at, session.timezone) : "18:30",
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
  // Tanggal dan jam form adalah jam lokal cabang yang dipilih.
  const branchZone = branches.data?.branches.find((b) => b.id === branchId)?.timezone;
  const startsAt = localInstant(form.day, form.time, branchZone).toISOString();

  const save = useMutation({
    mutationFn: (publish: boolean) =>
      session
        ? schedulingApi.updateSession(session.id, {
            ...(hasBookings ? {} : { class_type_id: form.class_type_id, credit_cost: num(form.credit_cost) ?? undefined }),
            ...(branchId !== (session.branch_id ?? "") ? { branch_id: branchId || null } : {}),
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
            branch_id: branchId || null,
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
                ? "Memindah jam atau mengganti coach mengabari member yang sudah booking. Kapasitas tidak bisa di bawah jumlah terdaftar."
                : "Kosongkan kapasitas, kredit, dan durasi untuk memakai default jenis kelas. Jendela booking mengikuti aturan gym."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Jenis kelas"
              className="sm:col-span-2"
              hint={hasBookings ? "Sudah ada booking, jenis kelas dan biaya kredit terkunci." : undefined}
            >
              <select
                className={SELECT}
                value={form.class_type_id}
                onChange={set("class_type_id")}
                disabled={hasBookings}
                required
              >
                <option value="">Pilih jenis kelas</option>
                {(classTypes.data ?? []).filter((t) => t.status === "active" || t.id === session?.class_type_id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.default_duration_min} mnt · {t.default_credit_cost} kredit
                  </option>
                ))}
              </select>
            </Field>
            {(branches.data?.branches.length ?? 0) > 0 && (
              <Field
                label="Cabang"
                className="sm:col-span-2"
                hint={
                  editing && branchLocked
                    ? "Sesi ini sudah pernah dibooking; cabang terkunci."
                    : editing
                      ? "Pindah cabang memakai aturan booking dan ruangan cabang tujuan."
                      : "Aturan booking cabang ini yang dipakai."
                }
              >
                <select
                  className={SELECT}
                  value={branchId}
                  onChange={(e) => setChosenBranch(e.target.value)}
                  disabled={editing && branchLocked}
                >
                  <option value="">Tanpa cabang (aturan global)</option>
                  {(branches.data?.branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Coach">
              <select className={SELECT} value={form.coach_id} onChange={set("coach_id")}>
                <option value="">Belum ditentukan</option>
                {(coaches.data ?? [])
                  .filter(
                    (c) =>
                      c.id === form.coach_id ||
                      (c.status === "active" && (!branchId || !c.branch_id || c.branch_id === branchId))
                  )
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
            <Field label={`Jam mulai (${zoneAbbr(branchZone)})`}>
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
            {!hasBookings && (
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
