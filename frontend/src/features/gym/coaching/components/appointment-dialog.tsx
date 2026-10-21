"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SELECT } from "@/features/gym/shared";
import { localClock, localDay, localInstant, zoneAbbr, zoneSuffix } from "@/lib/timezone";
import { rentangJam, tanggal } from "@/features/gym/scheduling/api";
import { MemberLink } from "@/features/gym/members/member-link";
import { COACHING_KEYS, coachingApi, PT_BADGE, type AppointmentAction, type PtAppointment, type PtParticipant } from "../api";
import { MemberPicker } from "./member-picker";

/**
 * Detail sesi PT dengan aksinya: konfirmasi permintaan, tandai selesai
 * (kredit dipotong), ubah jadwal (jam baru, coach lain), batalkan sesi,
 * tambah member, dan per member batal atau tidak hadir. Staf boleh
 * menghapus penalti batal terlambat dan tidak hadir.
 */
export function AppointmentDialog({
  appointment,
  onClose,
  onChanged,
}: {
  appointment: PtAppointment;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState(appointment);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [waive, setWaive] = useState(false);
  const a = current;
  const open = a.status === "requested" || a.status === "confirmed";
  const [openedAt] = useState(() => Date.now());
  const started = Date.parse(a.starts_at) <= openedAt;
  const active = a.participants.filter((p) => p.status === "requested" || p.status === "confirmed");

  const act = useMutation({
    mutationFn: (body: AppointmentAction) => coachingApi.act(a.id, body),
    onSuccess: (next, body) => {
      setCurrent(next);
      setCancelling(false);
      setAdding(false);
      setMoving(false);
      toast.success(
        {
          confirm: "Sesi dikonfirmasi",
          cancel: "Sesi dibatalkan",
          complete: "Sesi selesai, kredit dipotong",
          add_member: "Member ditambahkan",
          reschedule: "Jadwal sesi diubah, member diberi tahu",
        }[body.action]
      );
      onChanged();
    },
    onError: (error) => toast.error("Aksi gagal", { description: error.message }),
  });

  const participant = useMutation({
    mutationFn: ({ p, action }: { p: PtParticipant; action: "cancel" | "no_show" }) =>
      coachingApi.participant(p.id, { action, waive }),
    onSuccess: (res, { action }) => {
      toast.success(action === "cancel" ? "Member dibatalkan" : "Ditandai tidak hadir", {
        description: res.penalty ? `${formatNumber(res.penalty)} kredit PT dipotong.` : "Tanpa potongan kredit.",
      });
      onChanged();
      onClose();
    },
    onError: (error) => toast.error("Aksi gagal", { description: error.message }),
  });

  const badge = PT_BADGE[a.status];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{a.class_type_name}</DialogPanelTitle>
          <DialogPanelDescription>
            {tanggal(a.starts_at, a.timezone)}, {rentangJam(a.starts_at, a.ends_at, a.timezone)}
            {zoneSuffix(a.timezone) ? "" : " WIB"} · {a.coach_name}
            {a.branch_name && ` · ${a.branch_name}`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className="text-muted-foreground">
              {a.source === "member" ? "Diminta member" : "Dibooking staf"} · {formatNumber(a.credit_cost)} kredit per member ·
              kapasitas {formatNumber(a.capacity)}
              {a.reschedule_count > 0 && ` · dipindahkan member ${formatNumber(a.reschedule_count)}×`}
            </span>
          </div>
          {a.notes && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm whitespace-pre-line">{a.notes}</p>}
          {a.cancel_reason && <p className="text-sm text-muted-foreground">Alasan batal: {a.cancel_reason}</p>}

          <div>
            <p className="mb-2 text-sm font-semibold">Member</p>
            <ul className="flex flex-col gap-1.5">
              {a.participants.map((p) => {
                const pb = PT_BADGE[p.status];
                const pOpen = p.status === "requested" || p.status === "confirmed";
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2">
                    <span className="min-w-0">
                      <MemberLink id={p.customer_id} name={p.name} />
                      <span className="block text-xs text-muted-foreground">
                        {p.phone}
                        {p.checked_in_at && ` · check-in ${localClock(p.checked_in_at, a.timezone)}`}
                        {p.credits_charged > 0 && ` · ${formatNumber(p.credits_charged)} kredit dipotong`}
                        {p.late_cancel && " · batal terlambat"}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={pb.variant}>{pb.label}</Badge>
                      {pOpen && open && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={participant.isPending}
                          onClick={() => participant.mutate({ p, action: "cancel" })}
                        >
                          Batalkan
                        </Button>
                      )}
                      {p.status === "confirmed" && a.status === "confirmed" && started && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={participant.isPending}
                          onClick={() => participant.mutate({ p, action: "no_show" })}
                        >
                          Tidak hadir
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {open && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
                Hapus penalti batal terlambat atau tidak hadir
              </label>
            )}
          </div>

          {adding && (
            <MemberPicker
              classTypeId={a.class_type_id}
              exclude={active.map((p) => p.customer_id)}
              onPick={(m) => act.mutate({ action: "add_member", customer_id: m.id })}
            />
          )}
          {cancelling && (
            <Field label="Alasan pembatalan" hint="Dikirim ke member bersama notifikasi pembatalan.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Contoh: coach sakit" />
            </Field>
          )}
          {moving && (
            <RescheduleForm
              appointment={a}
              pending={act.isPending}
              onSubmit={(body) => act.mutate(body)}
              onCancel={() => setMoving(false)}
            />
          )}
        </DialogPanelBody>
        <DialogFooter className="flex-wrap">
          {open && !cancelling && (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Batalkan sesi
            </Button>
          )}
          {open && !moving && !cancelling && (
            <Button variant="outline" onClick={() => setMoving(true)}>
              Ubah jadwal
            </Button>
          )}
          {cancelling && (
            <Button variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ action: "cancel", reason: reason.trim() })}>
              Ya, batalkan sesi
            </Button>
          )}
          {open && active.length < a.capacity && !adding && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              Tambah member
            </Button>
          )}
          {a.status === "requested" && (
            <Button disabled={act.isPending} onClick={() => act.mutate({ action: "confirm" })}>
              Konfirmasi
            </Button>
          )}
          {a.status === "confirmed" && (
            <Button
              disabled={act.isPending || !started}
              title={started ? undefined : "Bisa ditandai selesai setelah sesi dimulai"}
              onClick={() => act.mutate({ action: "complete" })}
            >
              Tandai selesai
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * Jam baru (dan coach lain bila perlu) untuk sesi yang masih terbuka. Durasi
 * sesi tetap; bentrok dengan kelas atau PT lain coach ditolak server, dan
 * kredit member tetap tertahan.
 */
function RescheduleForm({
  appointment: a,
  pending,
  onSubmit,
  onCancel,
}: {
  appointment: PtAppointment;
  pending: boolean;
  onSubmit: (body: AppointmentAction) => void;
  onCancel: () => void;
}) {
  const coaches = useQuery({ queryKey: COACHING_KEYS.coaches(true), queryFn: () => coachingApi.coaches(true) });
  const [coachId, setCoachId] = useState(a.coach_id);
  const [day, setDay] = useState(localDay(a.starts_at, a.timezone));
  const [time, setTime] = useState(localClock(a.starts_at, a.timezone));
  const zone = (coaches.data ?? []).find((c) => c.id === coachId)?.timezone ?? a.timezone;
  const slots = useQuery({
    queryKey: [...COACHING_KEYS.slots, coachId, a.class_type_id, day],
    queryFn: () => coachingApi.slots({ coach_id: coachId, class_type_id: a.class_type_id, from: day, days: 1 }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(day),
  });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-2xl bg-surface-2 p-3 sm:grid-cols-3">
      <p className="text-sm font-semibold sm:col-span-3">Ubah jadwal sesi</p>
      <Field label="Coach">
        <select className={SELECT} value={coachId} onChange={(e) => setCoachId(e.target.value)}>
          {(coaches.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tanggal">
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <Field label={`Jam mulai (${zoneAbbr(zone)})`}>
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <div className="sm:col-span-3">
        <p className="mb-1.5 text-xs font-medium">Jam kosong coach</p>
        {slots.isLoading ? (
          <p className="text-xs text-muted-foreground">Memuat…</p>
        ) : (slots.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada jam kosong di jadwal PT coach hari ini. Jam lain tetap bisa dipilih selama coach tidak mengajar.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(slots.data ?? []).map((s) => {
              const clock = localClock(s.starts_at, zone);
              return (
                <button
                  key={s.starts_at}
                  type="button"
                  onClick={() => setTime(clock)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold tabular-nums transition",
                    time === clock ? "bg-ink text-on-ink" : "bg-card text-foreground hover:bg-surface"
                  )}
                >
                  {clock}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!valid || pending}
          onClick={() =>
            onSubmit({
              action: "reschedule",
              starts_at: localInstant(day, time, zone).toISOString(),
              coach_id: coachId !== a.coach_id ? coachId : undefined,
            })
          }
        >
          Simpan jadwal baru
        </Button>
      </div>
    </div>
  );
}
