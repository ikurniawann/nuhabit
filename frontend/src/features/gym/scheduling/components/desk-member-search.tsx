"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOOKING_BADGE, GYM_KEYS, jam, schedulingApi, type CheckInResult, type DeskMember } from "../api";
import { useDebounced } from "@/features/gym/use-debounced";
import { useBookingActions } from "@/features/gym/permissions";
import { WaiverDeskForm } from "./waiver-desk-form";

/**
 * Check-in tanpa QR: cari member (nama, HP, kode member), lihat booking
 * hari ini, lalu check-in dari front desk. Kredit dipotong seperti di gate.
 */
export function DeskMemberSearch({ onResult }: { onResult: (result: CheckInResult) => void }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const members = useQuery({
    queryKey: [...GYM_KEYS.deskMembers, term],
    queryFn: () => schedulingApi.deskMembers(term),
    enabled: term.length >= 2,
  });
  const checkIn = useMutation({
    mutationFn: schedulingApi.checkInBooking,
    onSuccess: (result) => {
      onResult(result);
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.deskMembers });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.checkin });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    },
    onError: (error) => toast.error("Check-in gagal", { description: error.message }),
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nama, nomor HP, atau kode member"
          aria-label="Cari member"
        />
      </div>
      {term.length < 2 ? (
        <p className="text-xs text-muted-foreground">Ketik minimal 2 huruf.</p>
      ) : members.isLoading ? (
        <p className="text-sm text-muted-foreground">Mencari…</p>
      ) : members.error ? (
        <p className="text-sm text-danger">{members.error.message}</p>
      ) : (members.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Member tidak ditemukan.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(members.data ?? []).map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              pending={checkIn.isPending}
              onCheckIn={(id) => checkIn.mutate(id)}
              onWaiver={() => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.deskMembers })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  member,
  pending,
  onCheckIn,
  onWaiver,
}: {
  member: DeskMember;
  pending: boolean;
  onCheckIn: (bookingId: string) => void;
  onWaiver: () => void;
}) {
  const can = useBookingActions();
  return (
    <li className="rounded-2xl bg-surface-2 px-4 py-3">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {member.name ?? "Tanpa nama"}
        {member.is_active === false && <Badge variant="destructive">Nonaktif</Badge>}
        {member.waiver_current ? (
          <Badge variant="success">Waiver v{member.waiver_version}</Badge>
        ) : (
          <Badge variant="warning">{member.waiver_accepted_at ? `Waiver lama v${member.waiver_version}` : "Belum waiver"}</Badge>
        )}
      </p>
      <p className="font-mono text-xs text-muted-foreground">{[member.phone, member.member_code].filter(Boolean).join(" · ")}</p>
      {!member.waiver_current && (
        <div className="mt-2">
          <WaiverDeskForm customerId={member.id} onRecorded={onWaiver} />
        </div>
      )}
      {member.bookings.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Tidak ada booking hari ini. Pakai tab Drop-in untuk walk-in.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {member.bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                {b.class_type_name}, {jam(b.starts_at, b.timezone)}
                {b.coach_name && <span className="text-xs text-muted-foreground"> · {b.coach_name}</span>}
              </span>
              {b.status === "confirmed" && can.checkIn ? (
                <Button size="sm" disabled={pending} onClick={() => onCheckIn(b.id)}>
                  <UserCheck /> Check-in
                </Button>
              ) : (
                <Badge variant={BOOKING_BADGE[b.status].variant}>{BOOKING_BADGE[b.status].label}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
