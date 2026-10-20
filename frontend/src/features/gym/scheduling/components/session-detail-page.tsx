"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Coins, Hourglass, UserCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { MemberLink } from "@/features/gym/members/member-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatTime } from "@/lib/format";
import {
  BOOKING_BADGE,
  GYM_KEYS,
  schedulingApi,
  SESSION_BADGE,
  waktu,
  strikeRulesNote,
  type RosterEntry,
  type Session,
} from "../api";
import { Can } from "@/components/iam/can";
import { DESK_MENUS, SCHEDULE_MENUS, useBookingActions } from "@/features/gym/permissions";
import { BookingActionConfirm, type PendingBookingAction } from "./booking-action-confirm";
import { CorrectionDialog, type PendingCorrection } from "./correction-dialog";
import { SessionDialog } from "./session-dialog";

type SessionAction = "publish" | "cancel" | "complete" | "delete";
type BookingAction = "cancel" | "no_show" | "check_in";
type RosterAction = BookingAction | PendingCorrection["action"];

const SESSION_CONFIRM: Record<Exclude<SessionAction, "publish">, { title: string; description: string; label: string }> = {
  cancel: {
    title: "Batalkan sesi ini?",
    description:
      "Semua booking dan waitlist batal. Kredit yang sudah terpotong (check-in, batal terlambat, no-show) dikembalikan, dan setiap member mendapat notifikasi.",
    label: "Batalkan sesi",
  },
  complete: {
    title: "Tutup sesi ini?",
    description:
      "Member yang sudah check-in tercatat hadir. Yang terdaftar tapi belum check-in menjadi no-show dan kreditnya hangus sesuai kebijakan.",
    label: "Tutup sesi",
  },
  delete: {
    title: "Hapus sesi ini?",
    description: "Hanya sesi tanpa booking yang bisa dihapus.",
    label: "Hapus sesi",
  },
};

/** Gym → Sesi & Absensi → detail: roster, waitlist, check-in, no-show, tutup, batal. */
export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = [...GYM_KEYS.sessions, "detail", sessionId];
  const detail = useQuery({ queryKey: key, queryFn: () => schedulingApi.session(sessionId), refetchInterval: 30_000 });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Exclude<SessionAction, "publish"> | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    void queryClient.invalidateQueries({ queryKey: GYM_KEYS.bookings });
  };

  const sessionAction = useMutation({
    mutationFn: async (action: SessionAction) => {
      if (action !== "delete") return schedulingApi.sessionAction(sessionId, action);
      await schedulingApi.deleteSession(sessionId);
      return {};
    },
    onSuccess: (result, action) => {
      setConfirming(null);
      if (action === "delete") {
        toast.success("Sesi dihapus");
        router.push("/dashboard/gym/schedule");
        return;
      }
      if (action === "publish") toast.success("Sesi diterbitkan");
      if (action === "cancel")
        toast.success("Sesi dibatalkan", {
          description: `${formatNumber(result.notified ?? 0)} member dikabari, ${formatNumber(result.refundedCredits ?? 0)} kredit dikembalikan.`,
        });
      if (action === "complete")
        toast.success("Sesi ditutup", {
          description: `${formatNumber(result.completed ?? 0)} hadir, ${formatNumber(result.noShows ?? 0)} no-show, ${formatNumber(result.penaltyCredits ?? 0)} kredit hangus.`,
        });
      refresh();
    },
    onError: (error) => toast.error("Aksi sesi gagal", { description: error.message }),
  });

  const [pendingBooking, setPendingBooking] = useState<PendingBookingAction | null>(null);
  const bookingAction = useMutation({
    mutationFn: (input: { id: string; action: BookingAction; waivePenalty?: boolean }) =>
      schedulingApi.bookingAction(input.id, input.action, { waivePenalty: input.waivePenalty }),
    onSuccess: (data, input) => {
      setPendingBooking(null);
      if (input.action === "check_in") toast.success(data.message ?? "Check-in berhasil");
      if (input.action === "no_show")
        toast.success("Ditandai tidak hadir", {
          description: data.penaltyCredits ? `${data.penaltyCredits} kredit hangus.` : "Tanpa potongan kredit.",
        });
      if (input.action === "cancel")
        toast.success("Booking dibatalkan", {
          description: data.penaltyCredits
            ? `Batal terlambat: ${data.penaltyCredits} kredit hangus.`
            : data.passStrike
              ? "Batal terlambat: tercatat satu strike pada pass member."
              : undefined,
        });
      refresh();
    },
    onError: (error) => toast.error("Aksi booking gagal", { description: error.message }),
  });
  const [pendingCorrection, setPendingCorrection] = useState<PendingCorrection | null>(null);

  if (detail.isLoading) return <TableNote>Memuat sesi…</TableNote>;
  if (detail.error || !detail.data) return <TableNote tone="danger">{detail.error?.message ?? "Sesi tidak ditemukan"}</TableNote>;

  const { session, roster } = detail.data;
  const badge = SESSION_BADGE[session.status];
  const open = session.status === "published" || session.status === "full";
  const attending = roster.filter((b) => b.status !== "waitlist" && b.status !== "cancelled");
  const waitlist = roster.filter((b) => b.status === "waitlist");
  const cancelled = roster.filter((b) => b.status === "cancelled");
  const busy = sessionAction.isPending || bookingAction.isPending;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/gym/sessions" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> Semua sesi
      </Link>
      <PageHeader
        kicker={`${waktu(session.starts_at)}–${formatTime(session.ends_at)} · ${session.area ?? "Area belum ditentukan"}`}
        title={session.class_type_name}
        description={`${session.coach_name ?? "Coach belum ditentukan"} · ${session.credit_cost} kredit per member, dipotong saat check-in.`}
        actions={
          <>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Can menu={SCHEDULE_MENUS} action="update">
              {session.status === "draft" && (
                <Button onClick={() => sessionAction.mutate("publish")} disabled={busy}>
                  Terbitkan
                </Button>
              )}
              {(open || session.status === "draft") && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Ubah
                </Button>
              )}
              {open && (
                <Button variant="ink" onClick={() => setConfirming("complete")} disabled={busy}>
                  Tutup sesi
                </Button>
              )}
            </Can>
            {(open || session.status === "draft") && (
              <Can menu={SCHEDULE_MENUS} action={roster.length ? "update" : "delete"}>
                <Button variant="ghost" className="text-danger" onClick={() => setConfirming(roster.length ? "cancel" : "delete")}>
                  {roster.length ? "Batalkan" : "Hapus"}
                </Button>
              </Can>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Terdaftar"
          value={formatNumber(session.confirmed_count)}
          unit={`/ ${formatNumber(session.capacity)}`}
          icon={<Users />}
          tone="ink"
        />
        <StatCard label="Check-in" value={formatNumber(session.checked_in_count)} icon={<UserCheck />} tone={session.checked_in_count ? "success" : "default"} />
        <StatCard label="Waitlist" value={formatNumber(session.waitlist_count)} icon={<Hourglass />} tone={session.waitlist_count ? "info" : "default"} />
        <StatCard label="Kredit per kelas" value={formatNumber(session.credit_cost)} icon={<Coins />} />
      </div>

      <Card className="py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h2 className="text-base font-semibold">Peserta</h2>
          {open && (
            <Can menu={DESK_MENUS} action="create">
              <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
                <UserPlus /> Daftarkan member
              </Button>
            </Can>
          )}
        </div>
        <RosterTable
          rows={[...attending, ...waitlist]}
          empty="Belum ada member yang booking."
          disabled={busy}
          correctable={session.status !== "cancelled"}
          onAction={(b, action) => {
            if (action === "undo_check_in" || action === "undo_no_show") {
              setPendingCorrection({ id: b.id, action, memberName: b.name });
            } else if (action === "check_in") {
              bookingAction.mutate({ id: b.id, action });
            } else {
              setPendingBooking({ id: b.id, action, memberName: b.name, waitlist: b.status === "waitlist" });
            }
          }}
        />
        {cancelled.length > 0 && (
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            {formatNumber(cancelled.length)} booking batal
            {cancelled.some((b) => b.late_cancel) && `, ${formatNumber(cancelled.filter((b) => b.late_cancel).length)} di antaranya batal terlambat`}.
          </p>
        )}
      </Card>

      {editing && (
        <SessionDialog session={session} hasAnyBooking={roster.length > 0} onClose={() => setEditing(false)} onSaved={refresh} />
      )}
      {adding && <AddMemberDialog session={session} onClose={() => setAdding(false)} onAdded={refresh} />}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(value) => !value && setConfirming(null)}
        title={confirming ? SESSION_CONFIRM[confirming].title : ""}
        description={confirming ? SESSION_CONFIRM[confirming].description : undefined}
        confirmLabel={confirming ? SESSION_CONFIRM[confirming].label : undefined}
        variant={confirming === "complete" ? "default" : "danger"}
        loading={sessionAction.isPending}
        onConfirm={() => confirming && sessionAction.mutate(confirming)}
      />
      <BookingActionConfirm
        pending={pendingBooking}
        loading={bookingAction.isPending}
        onClose={() => setPendingBooking(null)}
        onConfirm={(input) => bookingAction.mutate(input)}
      />
      <CorrectionDialog
        pending={pendingCorrection}
        onClose={() => setPendingCorrection(null)}
        onDone={() => {
          setPendingCorrection(null);
          refresh();
        }}
      />
    </div>
  );
}

function RosterTable({
  rows,
  empty,
  disabled,
  correctable,
  onAction,
}: {
  rows: RosterEntry[];
  empty: string;
  disabled: boolean;
  /** Koreksi check-in dan tidak hadir; sesi yang dibatalkan sudah mengembalikan kredit. */
  correctable: boolean;
  onAction: (booking: RosterEntry, action: RosterAction) => void;
}) {
  const can = useBookingActions();
  if (rows.length === 0) return <TableNote>{empty}</TableNote>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Tandai</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => {
          const badge = BOOKING_BADGE[b.status];
          return (
            <TableRow key={b.id}>
              <TableCell>
                <MemberLink id={b.customer_id} name={b.name} />
                <p className="font-mono text-xs text-muted-foreground">{b.phone}</p>
              </TableCell>
              <TableCell className="whitespace-normal">
                <Badge variant={badge.variant}>
                  {b.status === "waitlist" ? `Waitlist #${b.waitlist_position}` : badge.label}
                </Badge>
                {b.promotion_offered_at && (
                  <span className="ml-2 text-xs text-info">
                    kursi ditawarkan{b.promotion_expires_at ? ` sampai ${formatTime(b.promotion_expires_at)}` : ""}
                  </span>
                )}
                {b.checked_in_at && <span className="ml-2 text-xs text-muted-foreground">{formatTime(b.checked_in_at)}</span>}
                {b.source === "admin" && <span className="ml-2 text-xs text-muted-foreground">oleh staf</span>}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {b.status === "confirmed" && can.checkIn && (
                    <Button size="sm" variant="soft" disabled={disabled} onClick={() => onAction(b, "check_in")}>
                      Check-in
                    </Button>
                  )}
                  {b.status === "confirmed" && can.noShow && (
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction(b, "no_show")}>
                      Tidak hadir
                    </Button>
                  )}
                  {can.cancel && (b.status === "confirmed" || b.status === "waitlist") && (
                    <Button size="sm" variant="ghost" className="text-danger" disabled={disabled} onClick={() => onAction(b, "cancel")}>
                      {b.status === "waitlist" ? "Keluarkan" : "Batalkan"}
                    </Button>
                  )}
                  {correctable && (b.status === "checked_in" || b.status === "completed") && (
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction(b, "undo_check_in")}>
                      Batalkan check-in
                    </Button>
                  )}
                  {correctable && b.status === "no_show" && (
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction(b, "undo_no_show")}>
                      Hapus tidak hadir
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function AddMemberDialog({ session, onClose, onAdded }: { session: Session; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  // Walk-in / terlambat: jendela booking sudah tutup tapi kelas belum selesai.
  // Dibaca sekali saat dialog dibuka.
  const [opened] = useState(() => Date.now());
  const [walkIn, setWalkIn] = useState(opened > Date.parse(session.booking_closes_at));
  const walkInAllowed = opened < Date.parse(session.ends_at);
  const members = useQuery({
    queryKey: ["gym", "member-search", q, session.id],
    // Strike dihitung dengan aturan cabang sesi ini, sama seperti saat booking.
    queryFn: () => schedulingApi.searchMembers(q, { session_id: session.id }),
    enabled: q.trim().length >= 2,
  });
  const book = useMutation({
    mutationFn: (customerId: string) => schedulingApi.book(session.id, customerId, walkIn && walkInAllowed),
    onSuccess: (data) => {
      toast.success(data.status === "confirmed" ? "Member terdaftar" : `Kelas penuh, member di waitlist #${data.waitlistPosition}`);
      onAdded();
      onClose();
    },
    onError: (error) => toast.error("Member gagal didaftarkan", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Daftarkan member</DialogPanelTitle>
          <DialogPanelDescription>
            Aturan sama dengan booking dari portal: member aktif, jendela booking, batas booking, strike pass, dan sisa saldo
            minimal {session.credit_cost} kredit setelah booking lain yang belum berjalan.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          {walkInAllowed && (
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={walkIn} onCheckedChange={setWalkIn} aria-label="Walk-in atau terlambat" />
              <span>
                Walk-in atau terlambat
                <span className="block text-xs text-muted-foreground">Abaikan jendela booking. Saldo dan kapasitas tetap dicek.</span>
              </span>
            </label>
          )}
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau nomor HP" />
          {members.isFetching && <p className="text-sm text-muted-foreground">Mencari…</p>}
          {(members.data ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name ?? "Member"}</p>
                <p className="text-xs text-muted-foreground">
                  {m.phone} · {formatNumber(m.credits)} kredit{m.is_active ? "" : " · nonaktif"}
                  {m.pass_strikes > 0 && ` · ${formatNumber(m.pass_strikes)} strike`}
                </p>
                {m.suspended_until && (
                  <p className="text-xs font-medium text-warning">Booking ditangguhkan sampai {waktu(m.suspended_until)}</p>
                )}
              </div>
              <Button size="sm" disabled={book.isPending} onClick={() => book.mutate(m.id)}>
                Daftarkan
              </Button>
            </div>
          ))}
          {members.data?.length === 0 && <p className="text-sm text-muted-foreground">Member tidak ditemukan.</p>}
          {strikeRulesNote(members.data) && <p className="text-xs text-muted-foreground">{strikeRulesNote(members.data)}</p>}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
