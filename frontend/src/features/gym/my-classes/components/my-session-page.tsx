"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { BOOKING_BADGE, schedulingApi, SESSION_BADGE, waktu, type RosterEntry } from "@/features/gym/scheduling/api";
import { BookingActionConfirm, type PendingBookingAction } from "@/features/gym/scheduling/components/booking-action-confirm";
import { MiniStats } from "@/features/gym/scheduling/components/mini-stats";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatNumber, formatTime } from "@/lib/format";
import { MY_CLASSES_KEYS, myClassesApi } from "../api";

/** Kelas Saya → satu kelas: roster dengan check-in dan tandai tidak hadir. */
export function MySessionPage({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: MY_CLASSES_KEYS.session(sessionId),
    queryFn: () => myClassesApi.session(sessionId),
    refetchInterval: 30_000,
  });
  const [pending, setPending] = useState<PendingBookingAction | null>(null);
  const act = useMutation({
    mutationFn: (input: { id: string; action: "check_in" | "no_show" }) => schedulingApi.bookingAction(input.id, input.action),
    onSuccess: (data, input) => {
      setPending(null);
      if (input.action === "check_in") toast.success(data.message ?? "Check-in berhasil");
      else
        toast.success("Ditandai tidak hadir", {
          description: data.penaltyCredits ? `${data.penaltyCredits} kredit hangus.` : "Tanpa potongan kredit.",
        });
      void queryClient.invalidateQueries({ queryKey: MY_CLASSES_KEYS.all });
    },
    onError: (error) => toast.error("Absensi gagal disimpan", { description: error.message }),
  });

  if (detail.isLoading) return <TableNote>Memuat kelas…</TableNote>;
  if (detail.error || !detail.data) return <TableNote tone="danger">{detail.error?.message ?? "Kelas tidak ditemukan"}</TableNote>;

  const { session, roster } = detail.data;
  const badge = SESSION_BADGE[session.status];
  const attending = roster.filter((b) => b.status !== "waitlist" && b.status !== "cancelled");
  const waitlist = roster.filter((b) => b.status === "waitlist");

  return (
    <div className="space-y-4">
      <Link href="/dashboard/gym/my-classes" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> Kelas Saya
      </Link>
      <PageHeader
        kicker={`${waktu(session.starts_at)}–${formatTime(session.ends_at)}${session.area ? ` · ${session.area}` : ""}`}
        title={session.class_type_name}
        actions={<Badge variant={badge.variant}>{badge.label}</Badge>}
      />
      <MiniStats
        items={[
          { label: "Terdaftar", value: `${formatNumber(session.confirmed_count)}/${formatNumber(session.capacity)}` },
          { label: "Check-in", value: formatNumber(session.checked_in_count) },
          { label: "Tidak hadir", value: formatNumber(session.no_show_count) },
        ]}
      />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Peserta</h2>
        {attending.length === 0 ? (
          <Card className="py-0">
            <TableNote>Belum ada member yang booking.</TableNote>
          </Card>
        ) : (
          <Card className="divide-y divide-border py-0">
            {attending.map((b) => (
              <RosterRow
                key={b.id}
                booking={b}
                busy={act.isPending}
                onCheckIn={() => act.mutate({ id: b.id, action: "check_in" })}
                onNoShow={() => setPending({ id: b.id, action: "no_show", memberName: b.name, waitlist: false })}
              />
            ))}
          </Card>
        )}
      </section>

      {waitlist.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Waitlist</h2>
          <Card className="divide-y divide-border py-0">
            {waitlist.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="truncate">{b.name ?? b.phone}</span>
                <Badge variant="info">#{b.waitlist_position}</Badge>
              </div>
            ))}
          </Card>
        </section>
      )}

      <BookingActionConfirm
        pending={pending}
        loading={act.isPending}
        onClose={() => setPending(null)}
        onConfirm={(input) => input.action === "no_show" && act.mutate({ id: input.id, action: "no_show" })}
      />
    </div>
  );
}

function RosterRow({
  booking: b,
  busy,
  onCheckIn,
  onNoShow,
}: {
  booking: RosterEntry;
  busy: boolean;
  onCheckIn: () => void;
  onNoShow: () => void;
}) {
  const badge = BOOKING_BADGE[b.status];
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{b.name ?? "Tanpa nama"}</span>
        <span className="block font-mono text-xs text-muted-foreground">{b.phone}</span>
      </span>
      {b.status === "confirmed" ? (
        <span className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={onCheckIn}>
            Check-in
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onNoShow}>
            Tidak hadir
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {b.checked_in_at && <span className="text-xs text-muted-foreground">{formatTime(b.checked_in_at)}</span>}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </span>
      )}
    </div>
  );
}
