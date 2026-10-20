"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { gymCreditsApi } from "@/features/gym/credits/api";
import { SellDialog } from "@/features/gym/credits/components/sell-dialog";
import { formatNumber, formatTime } from "@/lib/format";
import { Can } from "@/components/iam/can";
import { DESK_MENUS } from "@/features/gym/permissions";
import { GYM_KEYS, schedulingApi, strikeRulesNote, waktu, type CheckInResult, type MemberHit, type Session } from "../api";
import { DROP_IN_LEAD_MS, dropInSessions } from "../drop-in";

const HOUR = 3_600_000;

/** Jam sekarang yang diperbarui tiap menit, agar daftar sesi ikut bergeser. */
function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * Drop-in: pilih sesi yang sedang berjalan, cari member, jual paket bila
 * kreditnya kurang, lalu daftarkan di luar jendela booking dan check-in.
 */
export function DropInPanel({ branchId, onResult }: { branchId: string; onResult: (result: CheckInResult) => void }) {
  const queryClient = useQueryClient();
  const now = useNow();
  const range = { from: new Date(now - 4 * HOUR).toISOString(), to: new Date(now + DROP_IN_LEAD_MS).toISOString() };
  const sessions = useQuery({
    queryKey: [...GYM_KEYS.sessions, "drop-in", branchId, range.from],
    queryFn: () => schedulingApi.sessions({ ...range, status: "published,full", branch_id: branchId || undefined }),
  });
  const options = dropInSessions(sessions.data ?? [], now);
  const [sessionId, setSessionId] = useState("");
  const session = options.find((s) => s.id === sessionId);

  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const members = useQuery({
    queryKey: ["gym", "member-search", term, sessionId, branchId],
    // Strike dihitung dengan aturan cabang sesi yang dipilih, sama seperti saat booking.
    queryFn: () => schedulingApi.searchMembers(term, { session_id: sessionId || undefined, branch_id: branchId || undefined }),
    enabled: term.length >= 2,
  });
  const [member, setMember] = useState<MemberHit | null>(null);
  const [selling, setSelling] = useState(false);
  const credits = useQuery({
    queryKey: ["gym-credits", "member", member?.id],
    queryFn: () => gymCreditsApi.memberCredits(member!.id),
    enabled: selling && Boolean(member),
  });

  const admit = useMutation({
    mutationFn: async ({ session, member }: { session: Session; member: MemberHit }) => {
      const booked = await schedulingApi.book(session.id, member.id, true);
      if (booked.status !== "confirmed") {
        throw new Error(`Kelas penuh. Member masuk waitlist #${booked.waitlistPosition}.`);
      }
      return schedulingApi.checkInBooking(booked.bookingId);
    },
    onSuccess: (result) => {
      onResult(result);
      setMember(null);
      setQ("");
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.checkin });
    },
    onError: (error) => toast.error("Drop-in gagal", { description: error.message }),
  });

  const short = Boolean(session && member && member.credits < session.credit_cost);

  return (
    <div className="space-y-4">
      <Field label="Sesi" hint="Sesi yang sedang berjalan atau mulai dalam satu jam.">
        <select className={SELECT} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">{sessions.isLoading ? "Memuat sesi…" : options.length ? "Pilih sesi" : "Tidak ada sesi saat ini"}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {formatTime(s.starts_at)} · {s.class_type_name}
              {s.coach_name ? ` · ${s.coach_name}` : ""} · sisa {formatNumber(s.seats_left)} kursi
            </option>
          ))}
        </select>
      </Field>
      {sessions.error && <p className="text-sm text-danger">{sessions.error.message}</p>}

      {session && (
        <div className="space-y-3">
          {member ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name ?? "Member"}</p>
                <p className="text-xs text-muted-foreground">
                  {member.phone} · {formatNumber(member.credits)} kredit
                  {short ? ` · kurang untuk kelas ${formatNumber(session.credit_cost)} kredit` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
                Ganti
              </Button>
            </div>
          ) : (
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau nomor HP" aria-label="Cari member" />
              {members.isFetching && <p className="text-sm text-muted-foreground">Mencari…</p>}
              <ul className="flex flex-col gap-2">
                {(members.data ?? []).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setMember(m)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-2 text-left hover:bg-surface"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.name ?? "Member"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {m.phone}
                          {m.is_active ? "" : " · nonaktif"}
                          {m.pass_strikes > 0 && ` · ${formatNumber(m.pass_strikes)} strike`}
                        </span>
                        {m.suspended_until && (
                          <span className="block text-xs font-medium text-warning">Booking ditangguhkan sampai {waktu(m.suspended_until)}</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(m.credits)} kredit</span>
                    </button>
                  </li>
                ))}
              </ul>
              {members.data?.length === 0 && <p className="text-sm text-muted-foreground">Member tidak ditemukan.</p>}
              {strikeRulesNote(members.data) && <p className="text-xs text-muted-foreground">{strikeRulesNote(members.data)}</p>}
            </>
          )}

          {member && (
            <div className="flex flex-wrap gap-2">
              {short && (
                <Can menu="gym.credits" action="create">
                  <Button variant="outline" onClick={() => setSelling(true)} disabled={!member.is_active}>
                    <ShoppingCart /> Jual paket
                  </Button>
                </Can>
              )}
              <Can menu={DESK_MENUS} action="create" mode="disable">
                <Button onClick={() => admit.mutate({ session, member })} disabled={admit.isPending}>
                  <UserCheck /> {admit.isPending ? "Memproses…" : "Daftarkan & check-in"}
                </Button>
              </Can>
            </div>
          )}
          {short && (
            <p className="text-xs text-muted-foreground">Member dengan pass aktif tetap bisa langsung didaftarkan.</p>
          )}
        </div>
      )}

      {selling && credits.data && (
        <SellDialog
          credits={credits.data}
          branchId={session?.branch_id ?? (branchId || null)}
          onClose={() => setSelling(false)}
          onDone={(purchase) => {
            void queryClient.invalidateQueries({ queryKey: ["gym", "member-search"] });
            void queryClient.invalidateQueries({ queryKey: ["gym-credits"] });
            setMember((cur) => cur && { ...cur, credits: cur.credits + purchase.credits });
          }}
        />
      )}
      {selling && credits.error && <p className="text-sm text-danger">{credits.error.message}</p>}
    </div>
  );
}
