"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api-client";
import { BOOKING_STATUS_LABEL } from "@/lib/studio/booking";
import { addDays, COACH_LEVEL_LABEL } from "@/lib/studio/schedule";
import type { ApiMessage, MemberOption, PtCoach, PtProgram, PtSessionRow } from "../types";
import { formatDayLabel, initials, todayIso } from "../types";
import { EmptyState, LinkButton, Pill, StudioPageHeader } from "./ui-bits";

type SlotResult = { coach: PtCoach; slots: string[] };

export function StudioPtPage() {
  const [tab, setTab] = useState<"book" | "list">("book");
  const [listKey, setListKey] = useState(0);
  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Personal Training"
        subtitle="Booking sesi privat 1 coach 1 member dari jam kosong coach, dan pantau jadwal Personal Training."
        actions={<LinkButton href="/dashboard/studio/availability" variant="outline">Atur ketersediaan coach</LinkButton>}
      />
      <div className="mb-5 inline-flex rounded-lg border border-border bg-card p-0.5">
        {(["book", "list"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === t ? "bg-nh-forest text-nh-lime" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "book" ? "Booking baru" : "Jadwal Personal Training"}
          </button>
        ))}
      </div>
      {tab === "book" ? (
        <BookingFlow
          onBooked={() => {
            setListKey((k) => k + 1);
            setTab("list");
          }}
        />
      ) : (
        <PtSessionList key={listKey} />
      )}
    </div>
  );
}

function BookingFlow({ onBooked }: { onBooked: () => void }) {
  const today = todayIso();
  const [catalog, setCatalog] = useState<PtProgram[] | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<SlotResult[] | null>(null);
  const [pick, setPick] = useState<{ coach: PtCoach; time: string } | null>(null);
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ data: PtProgram[] }>("/api/studio/pt/catalog")
      .then((res) => {
        setCatalog(res.data);
        setProgramId((cur) => cur ?? res.data[0]?.id ?? null);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat program"));
  }, []);

  const loadSlots = useCallback(async () => {
    if (!programId) return;
    setSlots(null);
    setPick(null);
    try {
      setSlots((await apiGet<{ data: SlotResult[] }>(`/api/studio/pt/slots?program_id=${programId}&date=${date}`)).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat slot");
      setSlots([]);
    }
  }, [programId, date]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    if (member || q.trim().length < 2) {
      setMembers([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<{ data: MemberOption[] }>(`/api/studio/members?q=${encodeURIComponent(q.trim())}`)
        .then((res) => setMembers(res.data))
        .catch(() => setMembers([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, member]);

  const program = useMemo(() => catalog?.find((p) => p.id === programId) ?? null, [catalog, programId]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);

  async function book() {
    if (!program || !pick || !member) return;
    setBusy(true);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/pt/bookings", {
        customer_id: member.id,
        program_id: program.id,
        coach_id: pick.coach.id,
        date,
        start_time: pick.time,
      });
      toast.success(res.message ?? "Personal Training terbooking");
      onBooked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal booking");
      void loadSlots();
    } finally {
      setBusy(false);
    }
  }

  if (catalog === null) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (catalog.length === 0) {
    return (
      <EmptyState
        title="Belum ada program Personal Training"
        description="Buat program berjenis Personal Training di Program Kelas, lalu tautkan coach dan jamnya di Ketersediaan Coach."
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-3 text-[13px] font-semibold text-foreground">1. Program</p>
          <div className="flex flex-wrap gap-2">
            {catalog.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === programId}
                onClick={() => setProgramId(p.id)}
                className={`rounded-xl border px-4 py-2.5 text-left transition ${p.id === programId ? "border-nh-forest bg-nh-forest text-nh-beige" : "border-border bg-background hover:border-ring"}`}
              >
                <span className="block font-medium">{p.name}</span>
                <span className={`text-xs ${p.id === programId ? "text-nh-beige/70" : "text-muted-foreground"}`}>
                  {p.duration_minutes} menit · {p.coaches.length} coach
                </span>
              </button>
            ))}
          </div>
          {program?.description && <p className="mt-3 text-sm text-muted-foreground">{program.description}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-3 text-[13px] font-semibold text-foreground">2. Tanggal</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === date}
                onClick={() => setDate(d)}
                className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl border px-3 py-2 transition ${d === date ? "border-nh-forest bg-nh-forest text-nh-lime" : "border-border bg-background text-foreground hover:border-ring"}`}
              >
                <span className="text-[11px] uppercase">{new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short" })}</span>
                <span className="font-display text-lg font-semibold tabular-nums">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-3 text-[13px] font-semibold text-foreground">3. Coach & jam</p>
          {slots === null ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada coach untuk program ini. Tautkan di Ketersediaan Coach.</p>
          ) : (
            <div className="space-y-4">
              {slots.map(({ coach, slots: times }) => (
                <div key={coach.id} className="rounded-xl border border-border p-4">
                  <div className="flex gap-3">
                    {coach.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coach.photo_url} alt={coach.full_name} className="size-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-nh-forest font-display font-semibold text-nh-lime">{initials(coach.full_name)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-semibold text-foreground">
                        {coach.display_name || coach.full_name} <Pill tone={coach.level === "head_coach" ? "brand" : "positive"} className="ml-1 align-middle">{COACH_LEVEL_LABEL[coach.level]}</Pill>
                      </p>
                      {coach.specialties.length > 0 && <p className="text-xs text-muted-foreground">{coach.specialties.join(" · ")}</p>}
                      {coach.bio && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{coach.bio}</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {times.length === 0 && <span className="text-xs text-muted-foreground">Tidak ada jam kosong di tanggal ini.</span>}
                    {times.map((t) => {
                      const on = pick?.coach.id === coach.id && pick.time === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPick({ coach, time: t })}
                          className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums transition ${on ? "border-nh-forest bg-nh-lime font-semibold text-nh-forest" : "border-border bg-background text-foreground hover:border-ring"}`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm xl:sticky xl:top-4">
        <p className="text-[13px] font-semibold text-foreground">4. Member</p>
        {member ? (
          <div className="flex items-center justify-between rounded-xl border border-nh-forest bg-nh-lemon/50 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{member.name ?? "Tanpa nama"}</p>
              <p className="text-xs text-muted-foreground">{member.phone}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMember(null)}>Ganti</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Cari nama atau nomor HP" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {members.length > 0 && (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {members.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setMember(m)} className="w-full px-4 py-2.5 text-left text-sm transition hover:bg-nh-lemon/40">
                      <span className="font-medium text-foreground">{m.name ?? "Tanpa nama"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{m.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="rounded-xl bg-nh-forest p-4 text-nh-beige">
          <p className="text-xs text-nh-beige/70">Ringkasan</p>
          <p className="mt-1 font-display text-lg font-semibold">{program?.name ?? "—"}</p>
          <p className="text-sm text-nh-beige/80">
            {pick ? `${formatDayLabel(date)} · ${pick.time} · ${pick.coach.display_name || pick.coach.full_name}` : "Pilih coach & jam"}
          </p>
          <p className="mt-2 text-xs text-nh-beige/60">Memakai 1 kredit Personal Training dari pass yang paling cepat berakhir.</p>
        </div>
        <Button className="w-full" onClick={book} disabled={busy || !pick || !member}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />} Booking Personal Training
        </Button>
      </aside>
    </div>
  );
}

const STATUS_TONE: Record<string, "positive" | "warning" | "danger" | "neutral" | "brand"> = {
  booked: "positive",
  attended: "brand",
  no_show: "danger",
  late_cancelled: "danger",
  cancelled: "neutral",
  waitlisted: "warning",
};

function PtSessionList() {
  const [rows, setRows] = useState<PtSessionRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      setRows((await apiGet<{ data: PtSessionRow[] }>("/api/studio/pt/bookings")).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat jadwal");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(r: PtSessionRow) {
    if (!r.booking_id || !confirm(`Batalkan Personal Training ${r.member_name ?? ""} ${r.session_date} ${r.start_time}?`)) return;
    setBusyId(r.booking_id);
    try {
      const res = await apiPost<ApiMessage>(`/api/studio/bookings/${r.booking_id}/cancel`, { reason: "Dibatalkan front desk" });
      toast.success(res.message ?? "Dibatalkan");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membatalkan");
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState title="Belum ada sesi Personal Training" description="Booking dari tab Booking baru atau lewat Member App." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Waktu</th>
            <th className="px-4 py-3">Member</th>
            <th className="px-4 py-3">Program & coach</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = r.session_status === "cancelled" ? "cancelled" : r.booking_status ?? "booked";
            return (
              <tr key={r.session_id} className={`border-t border-border ${r.session_date === today ? "bg-nh-lemon/30" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium capitalize text-foreground">{formatDayLabel(r.session_date)}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{r.start_time}–{r.end_time}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-foreground">{r.member_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.member_phone} {r.pass_code ? `· ${r.pass_code}` : ""}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-foreground">{r.program_name}</div>
                  <div className="text-xs text-muted-foreground">{r.coach_name ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <Pill tone={STATUS_TONE[status] ?? "neutral"}>{BOOKING_STATUS_LABEL[status as keyof typeof BOOKING_STATUS_LABEL] ?? status}</Pill>
                </td>
                <td className="px-4 py-3 text-right">
                  {r.session_status === "scheduled" && r.booking_status === "booked" && (
                    <div className="flex justify-end gap-1">
                      <LinkButton href={`/dashboard/studio/attendance?date=${r.session_date}&session=${r.session_id}`} variant="outline">Check-in</LinkButton>
                      <Button variant="ghost" size="icon" className="size-8" aria-label="Batalkan" disabled={busyId === r.booking_id} onClick={() => cancel(r)}>
                        <XCircle className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
