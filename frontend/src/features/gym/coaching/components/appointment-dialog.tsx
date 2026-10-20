"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { formatNumber, formatTime } from "@/lib/format";
import { tanggal } from "@/features/gym/scheduling/api";
import { MemberLink } from "@/features/gym/members/member-link";
import { coachingApi, PT_BADGE, type PtAppointment, type PtParticipant } from "../api";
import { MemberPicker } from "./member-picker";

/**
 * Detail sesi PT dengan aksinya: konfirmasi permintaan, tandai selesai
 * (kredit dipotong), batalkan sesi, tambah member, dan per member batal atau
 * tidak hadir. Staf boleh menghapus penalti batal terlambat dan tidak hadir.
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
  const [waive, setWaive] = useState(false);
  const a = current;
  const open = a.status === "requested" || a.status === "confirmed";
  const [openedAt] = useState(() => Date.now());
  const started = Date.parse(a.starts_at) <= openedAt;
  const active = a.participants.filter((p) => p.status === "requested" || p.status === "confirmed");

  const act = useMutation({
    mutationFn: (body: Parameters<typeof coachingApi.act>[1]) => coachingApi.act(a.id, body),
    onSuccess: (next, body) => {
      setCurrent(next);
      setCancelling(false);
      setAdding(false);
      toast.success(
        { confirm: "Sesi dikonfirmasi", cancel: "Sesi dibatalkan", complete: "Sesi selesai, kredit dipotong", add_member: "Member ditambahkan" }[
          body.action
        ]
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
            {tanggal(a.starts_at)}, {formatTime(a.starts_at)}–{formatTime(a.ends_at)} WIB · {a.coach_name}
            {a.branch_name && ` · ${a.branch_name}`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className="text-muted-foreground">
              {a.source === "member" ? "Diminta member" : "Dibooking staf"} · {formatNumber(a.credit_cost)} kredit per member ·
              kapasitas {formatNumber(a.capacity)}
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
        </DialogPanelBody>
        <DialogFooter className="flex-wrap">
          {open && !cancelling && (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Batalkan sesi
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
