"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, PencilLine, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet } from "@/lib/api-client";
import { axisHeight, axisOffset, buildTimeAxis, coachLoad, layoutOverlaps, monthBounds, monthGrid, shiftMonth } from "@/lib/studio/calendar";
import { addDays, COACH_LEVEL_LABEL, SESSION_STATUS_LABEL, startOfWeek, toMinutes, WEEKDAY_SHORT } from "@/lib/studio/schedule";
import type { ApiList, CoachRow, ProgramRow, SessionRow } from "../types";
import { formatDayLabel, todayIso } from "../types";
import { LinkButton, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type View = "week" | "day" | "month";

/** Warna program dari palet NüHabit (DESIGN.md §2) — urut sesuai daftar program. */
const PALETTE = [
  { box: "bg-nh-forest text-nh-lime border-nh-forest", dot: "bg-nh-forest" },
  { box: "bg-nh-lettuce text-nh-forest border-nh-lettuce", dot: "bg-nh-lettuce" },
  { box: "bg-nh-ochre text-nh-forest border-nh-ochre", dot: "bg-nh-ochre" },
  { box: "bg-nh-mint text-nh-forest border-nh-forest", dot: "bg-nh-mint" },
  { box: "bg-nh-lime text-nh-forest border-nh-lime", dot: "bg-nh-lime" },
  { box: "bg-nh-everglade text-nh-beige border-nh-everglade", dot: "bg-nh-everglade" },
  { box: "bg-nh-lemon text-nh-forest border-nh-lettuce", dot: "bg-nh-lemon" },
  { box: "bg-nh-jungle text-nh-lettuce border-nh-jungle", dot: "bg-nh-jungle" },
] as const;
const CANCELLED_BOX = "border-dashed border-border bg-muted text-muted-foreground line-through opacity-70";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "month") return monthBounds(anchor);
  const monday = startOfWeek(anchor);
  return { from: monday, to: addDays(monday, 6) };
}

function rangeLabel(view: View, anchor: string): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", opts);
  if (view === "day") return fmt(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const { from, to } = rangeFor("week", anchor);
  return `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function StudioCalendarPage() {
  const today = todayIso();
  const params = useSearchParams();
  const initialView = (["week", "day", "month"] as const).find((v) => v === params.get("view")) ?? "week";
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? (params.get("date") as string) : today;

  const [view, setView] = useState<View>(initialView);
  const [anchor, setAnchor] = useState(initialDate);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [coachFilter, setCoachFilter] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(nowMinutes);

  // Layar sempit: mulai di tampilan Hari (grid minggu terlalu rapat di HP).
  useEffect(() => {
    if (!params.get("view") && window.innerWidth < 768) setView("day");
  }, [params]);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setSessions(null);
      try {
        const res = await apiGet<ApiList<SessionRow>>(`/api/studio/sessions?from=${range.from}&to=${range.to}`);
        setSessions(res.data);
        setRefreshedAt(new Date());
      } catch (e) {
        if (!silent) toast.error(e instanceof Error ? e.message : "Gagal memuat kalender");
        if (!silent) setSessions([]);
      }
    },
    [range.from, range.to]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Monitoring: segarkan data tiap 60 detik dan garis "sekarang" tiap menit.
  useEffect(() => {
    const t = setInterval(() => {
      void load(true);
      setNow(nowMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    Promise.all([
      apiGet<ApiList<ProgramRow>>("/api/studio/programs"),
      apiGet<ApiList<CoachRow>>("/api/studio/coaches"),
    ])
      .then(([p, c]) => {
        setPrograms(p.data);
        setCoaches(c.data);
      })
      .catch(() => undefined);
  }, []);

  const colorOf = useMemo(() => {
    const map = new Map<string, (typeof PALETTE)[number]>();
    programs.forEach((p, i) => map.set(p.id, PALETTE[i % PALETTE.length]));
    return (programId: string) => map.get(programId) ?? PALETTE[0];
  }, [programs]);

  const visible = useMemo(
    () =>
      (sessions ?? []).filter(
        (s) =>
          (!programFilter || s.program_id === programFilter) &&
          (!coachFilter || (coachFilter === "__none__" ? !s.coach_id : s.coach_id === coachFilter))
      ),
    [sessions, programFilter, coachFilter]
  );

  const active = visible.filter((s) => s.status !== "cancelled");
  const load_ = useMemo(() => coachLoad(visible), [visible]);
  const usedPrograms = useMemo(() => {
    const ids = new Set((sessions ?? []).map((s) => s.program_id));
    return programs.filter((p) => ids.has(p.id));
  }, [sessions, programs]);

  function move(delta: number) {
    if (view === "day") setAnchor(addDays(anchor, delta));
    else if (view === "week") setAnchor(addDays(anchor, 7 * delta));
    else setAnchor(shiftMonth(anchor, delta));
  }

  const scheduleHref = `/dashboard/studio/schedule?week=${startOfWeek(view === "month" ? (anchor.slice(0, 7) === today.slice(0, 7) ? today : `${anchor.slice(0, 7)}-01`) : anchor)}`;

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Kalender Kelas"
        subtitle="Pantau jadwal kelas per hari, minggu, atau bulan. Warna menandai program; kelas batal dicoret."
        actions={
          <LinkButton href={scheduleHref} variant="outline">
            <PencilLine /> Kelola jadwal
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Sebelumnya" onClick={() => move(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(today)}>Hari ini</Button>
          <Button variant="outline" size="icon" aria-label="Berikutnya" onClick={() => move(1)}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-1 font-display text-lg font-semibold capitalize text-foreground">{rangeLabel(view, anchor)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="w-full min-w-40 sm:w-auto" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)} aria-label="Filter program">
            <option value="">Semua program</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </NativeSelect>
          <NativeSelect className="w-full min-w-40 sm:w-auto" value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)} aria-label="Filter coach">
            <option value="">Semua coach</option>
            <option value="__none__">Tanpa coach</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </NativeSelect>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Tampilan">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${view === v ? "bg-nh-forest text-nh-lime" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v === "day" ? "Hari" : v === "week" ? "Minggu" : "Bulan"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {sessions === null ? (
            <div className="flex justify-center rounded-xl border border-border bg-card py-24 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : view === "month" ? (
            <MonthView
              anchor={anchor}
              today={today}
              sessions={visible}
              colorOf={colorOf}
              onPick={setSelected}
              onDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          ) : (
            <TimeGrid
              days={view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))}
              today={today}
              now={now}
              sessions={visible}
              colorOf={colorOf}
              large={view === "day"}
              onPick={setSelected}
              onDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          )}
        </div>

        <aside className="grid content-start gap-4 md:grid-cols-3 2xl:grid-cols-1">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Ringkasan {view === "day" ? "hari ini" : view === "week" ? "minggu ini" : "bulan ini"}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{active.length}</p>
                <p className="text-xs text-muted-foreground">kelas</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                  {active.reduce((s, x) => s + x.capacity, 0)}
                </p>
                <p className="text-xs text-muted-foreground">kursi</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {active.some((s) => !s.coach_id) && <Pill tone="warning">{active.filter((s) => !s.coach_id).length} tanpa coach</Pill>}
              {visible.some((s) => s.status === "cancelled") && (
                <Pill tone="danger">{visible.filter((s) => s.status === "cancelled").length} batal</Pill>
              )}
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              {refreshedAt ? `Diperbarui ${refreshedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : "Perbarui"}
            </button>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <Users className="size-4" /> Beban coach
            </p>
            {load_.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada kelas.</p>
            ) : (
              <ul className="space-y-2">
                {load_.map((c) => (
                  <li key={c.coach_id ?? "none"} className="flex items-center justify-between gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setCoachFilter(coachFilter === (c.coach_id ?? "__none__") ? "" : c.coach_id ?? "__none__")}
                      className={`truncate text-left transition hover:text-foreground ${c.coach_id ? "text-foreground" : "font-semibold text-destructive"} ${coachFilter === (c.coach_id ?? "__none__") ? "underline" : ""}`}
                    >
                      {c.coach_name}
                    </button>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {c.sessions} kelas · {(c.minutes / 60).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {usedPrograms.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-2 text-[13px] font-semibold text-foreground">Program</p>
              <ul className="space-y-1.5">
                {usedPrograms.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setProgramFilter(programFilter === p.id ? "" : p.id)}
                      className={`flex items-center gap-2 text-sm transition hover:text-foreground ${programFilter === p.id ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      <span className={`size-3 shrink-0 rounded-sm border border-border ${colorOf(p.id).dot}`} />
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {selected && <SessionDetail s={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Grid waktu (Hari / Minggu) ─────────────────────────────────────────────

function TimeGrid({
  days,
  today,
  now,
  sessions,
  colorOf,
  large,
  onPick,
  onDay,
}: {
  days: string[];
  today: string;
  now: number;
  sessions: SessionRow[];
  colorOf: (programId: string) => (typeof PALETTE)[number];
  large: boolean;
  onPick: (s: SessionRow) => void;
  onDay: (d: string) => void;
}) {
  const hourPx = large ? 84 : 64;
  const gapPx = 34;
  const axis = buildTimeAxis(sessions);
  const height = axisHeight(axis, hourPx, gapPx);
  const y = (minutes: number) => axisOffset(axis, minutes, hourPx, gapPx);
  const top = (time: string) => y(toMinutes(time));
  const axisStart = axis[0].from * 60;
  const axisEnd = axis[axis.length - 1].to * 60;
  /** Garis jam (bukan batas pita celah) dan label jam di gutter. */
  const hourMarks = axis.flatMap((seg) =>
    seg.kind === "gap" ? [] : Array.from({ length: seg.to - seg.from + 1 }, (_, k) => seg.from + k)
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <div style={{ minWidth: large ? 0 : 720 }}>
        {/* Header hari */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => {
            const isToday = d === today;
            const count = sessions.filter((s) => s.session_date === d && s.status !== "cancelled").length;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDay(d)}
                disabled={large}
                className="flex flex-col items-center gap-0.5 border-l border-border px-1 py-2 text-center transition enabled:hover:bg-nh-lemon/40"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {WEEKDAY_SHORT[(new Date(`${d}T00:00:00`).getDay() + 6) % 7]}
                </span>
                <span
                  className={`grid size-8 place-items-center rounded-full font-display text-base font-semibold tabular-nums ${isToday ? "bg-nh-forest text-nh-lime" : "text-foreground"}`}
                >
                  {Number(d.slice(8, 10))}
                </span>
                <span className="text-[11px] text-muted-foreground">{count} kelas</span>
              </button>
            );
          })}
        </div>

        {/* Badan grid */}
        <div className="grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height }}>
            {[...new Set(hourMarks)].map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: y(h * 60) }}>
                {h * 60 === axisStart || h * 60 === axisEnd ? "" : `${String(h).padStart(2, "0")}.00`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const daySessions = sessions.filter((s) => s.session_date === d);
            const laid = layoutOverlaps(daySessions);
            const showNow = d === today && now >= axisStart && now <= axisEnd;
            return (
              <div key={d} className={`relative border-l border-border ${d === today ? "bg-nh-lemon/20" : ""}`} style={{ height }}>
                {[...new Set(hourMarks)].filter((h) => h * 60 !== axisStart && h * 60 !== axisEnd).map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/70" style={{ top: y(h * 60) }} />
                ))}
                {axis.filter((seg) => seg.kind === "gap").map((seg) => (
                  <div
                    key={`gap-${seg.from}`}
                    className="absolute inset-x-0 flex items-center justify-center border-y border-border bg-secondary/70 text-[10px] font-medium text-muted-foreground"
                    style={{ top: y(seg.from * 60), height: gapPx }}
                  >
                    {d === days[0] || large ? `${String(seg.from).padStart(2, "0")}.00–${String(seg.to).padStart(2, "0")}.00 · tidak ada kelas` : ""}
                  </div>
                ))}
                {laid.map(({ item: s, lane, lanes }) => {
                  const cancelled = s.status === "cancelled";
                  const t = top(s.start_time);
                  const h = Math.max(top(s.end_time) - t - 3, 22);
                  const roomy = h >= 48;
                  const tall = h >= 84;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onPick(s)}
                      title={`${s.start_time}–${s.end_time} ${s.program_name} · ${s.coach_name ?? "tanpa coach"}`}
                      className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm transition hover:z-10 hover:ring-2 hover:ring-ring ${cancelled ? CANCELLED_BOX : colorOf(s.program_id).box}`}
                      style={{
                        top: t + 1,
                        height: h,
                        left: `calc(${(lane / lanes) * 100}% + 3px)`,
                        width: `calc(${100 / lanes}% - 6px)`,
                      }}
                    >
                      <span className="block whitespace-nowrap text-[11px] font-semibold tabular-nums opacity-90">
                        {s.start_time}–{s.end_time}
                      </span>
                      <span className={`block font-semibold leading-tight ${large ? "text-sm" : "text-xs"} ${tall ? "line-clamp-2" : "truncate"}`}>
                        {s.program_name}
                      </span>
                      {roomy && (
                        <span className={`mt-0.5 block truncate text-[11px] ${s.coach_id ? "opacity-80" : "font-semibold"}`}>
                          {s.coach_name ?? "Tanpa coach"}
                          {large ? ` · kuota ${s.capacity}` : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
                {showNow && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: y(now) }}>
                    <span className="-ml-1.5 size-3 rounded-full border-2 border-nh-forest bg-nh-lime" />
                    <span className="h-0.5 flex-1 bg-nh-forest" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Bulan ──────────────────────────────────────────────────────────────────

function MonthView({
  anchor,
  today,
  sessions,
  colorOf,
  onPick,
  onDay,
}: {
  anchor: string;
  today: string;
  sessions: SessionRow[];
  colorOf: (programId: string) => (typeof PALETTE)[number];
  onPick: (s: SessionRow) => void;
  onDay: (d: string) => void;
}) {
  const grid = monthGrid(anchor);
  const month = anchor.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b border-border bg-secondary/60">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((d, i) => {
          const list = sessions.filter((s) => s.session_date === d);
          const activeCount = list.filter((s) => s.status !== "cancelled").length;
          const inMonth = d.slice(0, 7) === month;
          return (
            <div
              key={d}
              className={`min-h-28 border-border p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-secondary/30"}`}
            >
              <button type="button" onClick={() => onDay(d)} className="mb-1 flex w-full items-center justify-between rounded px-1 transition hover:bg-nh-lemon/40">
                <span
                  className={`grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                    d === today ? "bg-nh-forest text-nh-lime" : inMonth ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {Number(d.slice(8, 10))}
                </span>
                {activeCount > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{activeCount}</span>}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPick(s)}
                    className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition hover:bg-nh-lemon/50 ${s.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    <span className={`size-2 shrink-0 rounded-full border border-border ${colorOf(s.program_id).dot}`} />
                    <span className="tabular-nums">{s.start_time}</span>
                    <span className="truncate">{s.program_name}</span>
                  </button>
                ))}
                {list.length > 3 && (
                  <button type="button" onClick={() => onDay(d)} className="px-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground">
                    +{list.length - 3} lagi
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail sesi ────────────────────────────────────────────────────────────

function SessionDetail({ s, onClose }: { s: SessionRow; onClose: () => void }) {
  const tone = s.status === "cancelled" ? "danger" : s.status === "completed" ? "positive" : "neutral";
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s.program_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="capitalize text-foreground">
              {formatDayLabel(s.session_date)} · <span className="tabular-nums">{s.start_time}–{s.end_time}</span>
            </span>
            <Pill tone={tone}>{SESSION_STATUS_LABEL[s.status]}</Pill>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">Coach</dt>
              <dd className={s.coach_id ? "font-medium text-foreground" : "font-semibold text-destructive"}>
                {s.coach_name ?? "Belum ditentukan"}
                {s.coach_level && <span className="block text-xs font-normal text-muted-foreground">{COACH_LEVEL_LABEL[s.coach_level]}</span>}
              </dd>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">Kuota</dt>
              <dd className="font-medium tabular-nums text-foreground">{s.capacity} orang</dd>
            </div>
          </dl>
          {s.cancel_reason && <p className="text-destructive">Alasan batal: {s.cancel_reason}</p>}
          {s.notes && <p className="text-muted-foreground">{s.notes}</p>}
          {!s.template_id && <p className="text-xs text-muted-foreground">Sesi khusus (di luar template mingguan).</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <LinkButton href={`/dashboard/studio/schedule?week=${startOfWeek(s.session_date)}`}>
            <PencilLine /> Ubah di Jadwal Kelas
          </LinkButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
