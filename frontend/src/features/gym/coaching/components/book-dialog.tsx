"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/features/crm/engagement/components/shared";
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
import { cn } from "@/lib/utils";
import { SELECT } from "@/features/gym/shared";
import { wibDay, wibTime } from "@/features/gym/scheduling/api";
import { COACHING_KEYS, coachingApi, type PtMemberHit } from "../api";
import { MemberPicker } from "./member-picker";

const MAX_CAPACITY = 4;

/**
 * Booking PT langsung oleh staf atau coach: langsung terkonfirmasi untuk 1
 * sampai 4 member. Jam bebas dipilih; jam kosong coach ditampilkan sebagai
 * saran. Bentrok dengan kelas atau PT lain coach ditolak server.
 */
export function BookDialog({
  coachId,
  date,
  onClose,
  onBooked,
}: {
  coachId?: string;
  date: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const types = useQuery({ queryKey: COACHING_KEYS.types, queryFn: coachingApi.types });
  const coaches = useQuery({ queryKey: COACHING_KEYS.coaches(true), queryFn: () => coachingApi.coaches(true) });
  const [form, setForm] = useState({ class_type_id: "", coach_id: coachId ?? "", day: date, time: "", capacity: "", notes: "" });
  const [members, setMembers] = useState<PtMemberHit[]>([]);
  const type = (types.data ?? []).find((t) => t.id === form.class_type_id) ?? types.data?.[0];
  const capacity = Number(form.capacity) || type?.capacity || 1;

  const slots = useQuery({
    queryKey: [...COACHING_KEYS.slots, form.coach_id, type?.id, form.day],
    queryFn: () => coachingApi.slots({ coach_id: form.coach_id, class_type_id: type!.id, from: form.day, days: 1 }),
    enabled: Boolean(form.coach_id && type && /^\d{4}-\d{2}-\d{2}$/.test(form.day)),
  });

  const book = useMutation({
    mutationFn: () =>
      coachingApi.book({
        coach_id: form.coach_id,
        class_type_id: type!.id,
        starts_at: new Date(`${form.day}T${form.time}:00+07:00`).toISOString(),
        capacity,
        customer_ids: members.map((m) => m.id),
        notes: form.notes.trim(),
      }),
    onSuccess: () => {
      toast.success("Sesi PT dibooking", { description: "Member menerima notifikasi konfirmasi." });
      onBooked();
      onClose();
    },
    onError: (error) => toast.error("Booking PT gagal", { description: error.message }),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const valid =
    Boolean(type && form.coach_id) && /^\d{2}:\d{2}$/.test(form.time) && members.length > 0 && members.length <= capacity;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) book.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Booking sesi PT</DialogPanelTitle>
            <DialogPanelDescription>
              Sesi langsung terkonfirmasi. Kredit PT dicek sekarang dan dipotong saat sesi ditandai selesai.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Jenis sesi">
              <select className={SELECT} value={type?.id ?? ""} onChange={set("class_type_id")} required>
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.duration_min} mnt · {t.credit_cost} kredit
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Coach">
              <select className={SELECT} value={form.coach_id} onChange={set("coach_id")} required>
                <option value="">Pilih coach</option>
                {(coaches.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tanggal">
              <Input type="date" value={form.day} onChange={set("day")} required />
            </Field>
            <Field label="Jam mulai (WIB)">
              <Input type="time" value={form.time} onChange={set("time")} required />
            </Field>
            {form.coach_id && type && (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-sm font-medium">Jam kosong coach</p>
                {slots.isLoading ? (
                  <p className="text-xs text-muted-foreground">Memuat…</p>
                ) : (slots.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Tidak ada jam kosong di jadwal PT coach hari ini. Jam lain tetap bisa dipilih selama coach tidak mengajar.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(slots.data ?? []).map((s) => {
                      const time = wibTime(s.starts_at);
                      return (
                        <button
                          key={s.starts_at}
                          type="button"
                          onClick={() => setForm((cur) => ({ ...cur, time, day: wibDay(s.starts_at) }))}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-semibold tabular-nums transition",
                            form.time === time ? "bg-ink text-on-ink" : "bg-surface-2 text-foreground hover:bg-surface"
                          )}
                        >
                          {time}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Field label="Kapasitas" hint="1 untuk 1:1, sampai 4 untuk small group.">
              <Input
                type="number"
                min={Math.max(1, members.length)}
                max={MAX_CAPACITY}
                value={form.capacity}
                onChange={set("capacity")}
                placeholder={String(type?.capacity ?? 1)}
              />
            </Field>
            <Field label="Catatan untuk coach">
              <Input value={form.notes} onChange={set("notes")} maxLength={500} placeholder="Opsional" />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">
                Member ({members.length}/{capacity})
              </p>
              {members.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm">
                      {m.name ?? m.phone}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Hapus ${m.name ?? m.phone}`}
                        onClick={() => setMembers((cur) => cur.filter((x) => x.id !== m.id))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {members.length < capacity && (
                <MemberPicker
                  classTypeId={type?.id}
                  exclude={members.map((m) => m.id)}
                  onPick={(m) => setMembers((cur) => [...cur, m])}
                />
              )}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || book.isPending}>
              Booking sesi
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
