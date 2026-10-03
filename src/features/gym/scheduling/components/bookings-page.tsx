"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Hourglass, UserX } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/gym/booking";
import { addDays, angka, BOOKING_BADGE, GYM_KEYS, schedulingApi, SELECT, waktu, wibDay, wibDayStart } from "../api";

const RANGES = {
  next7: { label: "7 hari ke depan", from: 0, to: 8 },
  last7: { label: "7 hari lalu", from: -7, to: 1 },
  last30: { label: "30 hari lalu", from: -30, to: 1 },
} as const;
type RangeKey = keyof typeof RANGES;

/** Gym → Booking: semua booking kelas per rentang jadwal, cari member, aksi cepat. */
export function BookingsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("next7");
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [q, setQ] = useState("");
  const today = wibDay(new Date());
  const params = {
    from: wibDayStart(addDays(today, RANGES[range].from)),
    to: wibDayStart(addDays(today, RANGES[range].to)),
    status: status || undefined,
    q: q.trim().length >= 2 ? q.trim() : undefined,
  };
  const bookings = useQuery({
    queryKey: [...GYM_KEYS.bookings, params],
    queryFn: () => schedulingApi.bookings(params),
  });
  const action = useMutation({
    mutationFn: (input: { id: string; action: "cancel" | "no_show" | "check_in" }) =>
      schedulingApi.bookingAction(input.id, input.action),
    onSuccess: (data) => {
      toast.success(data.message ?? "Booking diperbarui", {
        description: data.penaltyCredits ? `${data.penaltyCredits} kredit hangus.` : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.bookings });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    },
    onError: (error) => toast.error("Aksi booking gagal", { description: error.message }),
  });
  const rows = bookings.data ?? [];
  const count = (s: BookingStatus) => rows.filter((b) => b.status === s).length;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Booking"
        description="Booking dari portal dan dari staf. Kredit dipotong saat check-in; batal terlambat dan no-show mengikuti aturan gym."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Terdaftar & check-in" value={angka(count("confirmed") + count("checked_in") + count("completed"))} icon={<CalendarCheck />} tone="ink" />
        <StatCard label="Waitlist" value={angka(count("waitlist"))} icon={<Hourglass />} tone={count("waitlist") ? "info" : "default"} />
        <StatCard
          label="No-show & batal terlambat"
          value={angka(count("no_show") + rows.filter((b) => b.late_cancel).length)}
          icon={<UserX />}
          tone={count("no_show") ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau nomor HP member" />
        <select className={SELECT} value={range} onChange={(e) => setRange(e.target.value as RangeKey)} aria-label="Rentang jadwal">
          {Object.entries(RANGES).map(([key, r]) => (
            <option key={key} value={key}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          value={status}
          onChange={(e) => setStatus(e.target.value as BookingStatus | "")}
          aria-label="Status booking"
        >
          <option value="">Semua status</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BOOKING_BADGE[s].label}
            </option>
          ))}
        </select>
      </div>

      <Card className="py-0">
        {bookings.isLoading ? (
          <TableNote>Memuat booking…</TableNote>
        ) : bookings.error ? (
          <TableNote tone="danger">{bookings.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada booking di rentang ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Kelas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const badge = BOOKING_BADGE[b.status];
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <p className="font-medium">{b.member_name ?? "Member"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{b.member_phone}</p>
                    </TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <Link href={`/dashboard/gym/sessions/${b.session_id}`} className="font-medium text-forest hover:underline">
                        {b.class_type_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {waktu(b.starts_at)} · {b.credit_cost} kredit{b.coach_name ? ` · ${b.coach_name}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Badge variant={badge.variant}>
                        {b.status === "waitlist" ? `Waitlist #${b.waitlist_position}` : badge.label}
                      </Badge>
                      {b.late_cancel && <span className="ml-2 text-xs text-warning">batal terlambat</span>}
                      {b.source === "admin" && <span className="ml-2 text-xs text-muted-foreground">oleh staf</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {b.status === "confirmed" && (
                          <>
                            <Button size="sm" variant="soft" disabled={action.isPending} onClick={() => action.mutate({ id: b.id, action: "check_in" })}>
                              Check-in
                            </Button>
                            <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ id: b.id, action: "no_show" })}>
                              Tidak hadir
                            </Button>
                          </>
                        )}
                        {(b.status === "confirmed" || b.status === "waitlist") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            disabled={action.isPending}
                            onClick={() => action.mutate({ id: b.id, action: "cancel" })}
                          >
                            Batalkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
