"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CalendarDays, Check, ChevronDown, Loader2, LogOut, Users, Wallet } from "lucide-react";
import { periodLabel } from "@/lib/studio/commission";
import { COACH_LEVEL_LABEL } from "@/lib/studio/schedule";
import { formatDayLabel, rupiah } from "@/features/studio/types";

interface Me {
  id: string;
  full_name: string;
  display_name: string | null;
  level: "coach" | "head_coach";
}

interface Session {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  capacity: number;
  program_name: string;
  program_kind: string;
  booked_count: number;
  attended_count: number;
  waitlist_count: number;
}

interface RosterRow {
  id: string;
  status: string;
  member_name: string;
  checked_in_at: string | null;
}

interface CommissionData {
  current: {
    period: string;
    total_pool: number;
    share_percent: number;
    amount: number;
    class_sessions: number;
    pt_sessions: number;
    attendees: number;
  };
  history: { id: string; period: string; period_status: string; share_percent: number; amount: number; class_sessions: number; pt_sessions: number; status: string; paid_at: string | null }[];
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

const kindLabel = (kind: string) => (kind === "pt" ? "Personal Training" : "Kelas");

export default function CoachPortalPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"schedule" | "commission">("schedule");

  useEffect(() => {
    getJson<{ data: Me }>("/api/coach/me")
      .then((r) => setMe(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat"));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login?redirect=/coach";
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-nh-forest/95 px-4 py-3 backdrop-blur">
        <Image src="/brand/logo-white.png" alt="NUHABIT" width={1325} height={173} className="h-4 w-auto" priority />
        <div className="flex items-center gap-3">
          {me && (
            <div className="text-right leading-tight">
              <p className="text-sm font-semibold">{me.display_name || me.full_name}</p>
              <p className="text-[11px] text-nh-lime">{COACH_LEVEL_LABEL[me.level]}</p>
            </div>
          )}
          <button type="button" onClick={logout} aria-label="Keluar" className="rounded-full p-2 text-nh-beige/70 transition hover:bg-white/10 hover:text-nh-beige">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {error ? (
        <div className="m-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm">
          <p>{error}</p>
          <button type="button" onClick={logout} className="mt-4 rounded-full bg-nh-lime px-5 py-2 text-sm font-semibold text-nh-forest">
            Masuk dengan akun lain
          </button>
        </div>
      ) : !me ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-nh-lime" />
        </div>
      ) : (
        <>
          <main className="flex-1 px-4 pb-28 pt-4">{tab === "schedule" ? <ScheduleTab /> : <CommissionTab />}</main>
          <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-xl gap-2 border-t border-white/10 bg-nh-forest/95 p-3 backdrop-blur">
            <TabButton active={tab === "schedule"} onClick={() => setTab("schedule")} icon={<CalendarDays className="size-4" />} label="Jadwal" />
            <TabButton active={tab === "commission"} onClick={() => setTab("commission")} icon={<Wallet className="size-4" />} label="Komisi" />
          </nav>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition ${active ? "bg-nh-lime text-nh-forest" : "text-nh-beige/70 hover:bg-white/5"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ScheduleTab() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [today, setToday] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getJson<{ data: Session[]; today: string }>("/api/coach/schedule");
      setSessions(r.data);
      setToday(r.today);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions ?? []) {
      if (s.status === "cancelled") continue;
      map.set(s.session_date, [...(map.get(s.session_date) ?? []), s]);
    }
    return [...map.entries()];
  }, [sessions]);

  if (!sessions) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-nh-lime" />;
  if (days.length === 0)
    return <p className="mt-10 text-center text-sm text-nh-beige/70">Belum ada jadwal mengajar dalam dua minggu ke depan.</p>;

  return (
    <div className="space-y-6">
      {days.map(([date, list]) => (
        <section key={date}>
          <h2 className={`mb-2 font-display text-sm font-semibold uppercase tracking-wide ${date === today ? "text-nh-lime" : "text-nh-beige/60"}`}>
            {date === today ? "Hari ini · " : ""}
            {formatDayLabel(date)}
          </h2>
          <div className="space-y-2">
            {list.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                canMark={date <= today && s.status !== "completed"}
                expanded={open === s.id}
                onToggle={() => setOpen(open === s.id ? null : s.id)}
                onChanged={load}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SessionCard({ session: s, canMark, expanded, onToggle, onChanged }: { session: Session; canMark: boolean; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    try {
      setRoster((await getJson<{ data: RosterRow[] }>(`/api/coach/sessions/${s.id}/roster`)).data);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal memuat peserta");
      setRoster([]);
    }
  }, [s.id]);

  useEffect(() => {
    if (expanded && !roster) void loadRoster();
  }, [expanded, roster, loadRoster]);

  async function toggle(r: RosterRow) {
    setBusy(r.id);
    setMsg(null);
    try {
      await getJson(`/api/coach/bookings/${r.id}/check-in`, { method: r.status === "attended" ? "DELETE" : "POST" });
      await loadRoster();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  }

  const isPt = s.program_kind === "pt";
  const active = (roster ?? []).filter((r) => r.status !== "waitlisted");
  const waitlist = (roster ?? []).filter((r) => r.status === "waitlisted");

  return (
    <div className={`overflow-hidden rounded-2xl border ${isPt ? "border-nh-lime/40 bg-nh-lime/5" : "border-white/10 bg-white/5"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="w-14 shrink-0 font-display tabular-nums">
          <p className="text-base font-semibold">{s.start_time}</p>
          <p className="text-[11px] text-nh-beige/60">{s.end_time}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{s.program_name}</p>
          <p className="text-xs text-nh-beige/60">
            {kindLabel(s.program_kind)}
            {s.status === "completed" ? " · selesai" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-nh-beige/80">
          <Users className="size-3.5" />
          <span className="tabular-nums">
            {s.attended_count}/{s.booked_count}
            {isPt ? "" : ` dari ${s.capacity}`}
          </span>
        </div>
        <ChevronDown className={`size-4 shrink-0 text-nh-beige/50 transition ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-white/10 px-4 py-3">
          {!roster ? (
            <Loader2 className="mx-auto my-3 size-5 animate-spin text-nh-lime" />
          ) : active.length === 0 ? (
            <p className="py-2 text-sm text-nh-beige/60">Belum ada peserta.</p>
          ) : (
            <ul className="space-y-1.5">
              {active.map((r) => {
                const attended = r.status === "attended";
                const markable = canMark && (r.status === "booked" || attended);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm">{r.member_name}</span>
                    {markable ? (
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => toggle(r)}
                        className={`flex min-w-24 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${attended ? "bg-nh-lime text-nh-forest" : "border border-white/20 text-nh-beige hover:bg-white/10"}`}
                      >
                        {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : attended ? <Check className="size-3.5" /> : null}
                        {attended ? "Hadir" : "Tandai hadir"}
                      </button>
                    ) : (
                      <span className="text-xs text-nh-beige/60">{STATUS_LABEL[r.status] ?? r.status}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {waitlist.length > 0 && <p className="mt-3 text-xs text-nh-beige/60">Waitlist: {waitlist.map((w) => w.member_name).join(", ")}</p>}
          {!canMark && s.status !== "completed" && <p className="mt-3 text-xs text-nh-beige/50">Kehadiran bisa ditandai pada hari sesi.</p>}
          {msg && <p className="mt-3 text-xs text-red-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  booked: "Terdaftar",
  attended: "Hadir",
  no_show: "Tidak hadir",
  late_cancelled: "Batal telat",
  waitlisted: "Waitlist",
};

function CommissionTab() {
  const [data, setData] = useState<CommissionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ data: CommissionData }>("/api/coach/commission")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat"));
  }, []);

  if (error) return <p className="mt-10 text-center text-sm text-red-300">{error}</p>;
  if (!data) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-nh-lime" />;
  const c = data.current;
  const history = data.history.filter((h) => h.period !== c.period);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-nh-lime p-5 text-nh-forest">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Estimasi {periodLabel(c.period)}</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums">{rupiah(c.amount)}</p>
        <p className="mt-2 text-xs opacity-80">
          {c.share_percent}% dari pool {rupiah(c.total_pool)} · berjalan sampai hari ini, angka final setelah disetujui akhir bulan.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Kelas" value={c.class_sessions} />
          <MiniStat label="Personal Training" value={c.pt_sessions} />
          <MiniStat label="Peserta hadir" value={c.attendees} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-nh-beige/60">Riwayat komisi</h2>
        {history.length === 0 ? (
          <p className="text-sm text-nh-beige/60">Belum ada komisi yang disetujui.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div>
                  <p className="font-semibold">{periodLabel(h.period)}</p>
                  <p className="text-xs text-nh-beige/60">
                    {h.class_sessions} kelas · {h.pt_sessions} Personal Training · {h.share_percent}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display font-semibold tabular-nums">{rupiah(h.amount)}</p>
                  <p className={`text-[11px] ${h.status === "paid" ? "text-nh-lime" : "text-nh-beige/60"}`}>{h.status === "paid" ? "Sudah dibayar" : "Menunggu pembayaran"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-nh-beige/50">Komisi dibayarkan di luar gaji, setiap akhir bulan setelah disetujui.</p>
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-nh-forest/10 px-2 py-2">
      <p className="font-display text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] leading-tight opacity-70">{label}</p>
    </div>
  );
}
