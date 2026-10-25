"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Download, ListChecks, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { PageHeader } from "@/components/ui/page-header";
import { todayWib } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { localClock, localDay, zoneSuffix } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { EVENTS_KEYS, eventsApi, KIND_LABEL, type CalendarEntry, type EntryKind } from "../api";
import {
  dayLabel,
  entryHref,
  groupByDay,
  KIND_TONE,
  monthLabel,
  monthOf,
  queryRange,
  shiftAnchor,
  shortDayLabel,
  visibleDays,
  WEEKDAYS_SHORT,
  weekLabel,
  type CalendarView,
} from "../calendar";
import { EventChecklistDialog } from "./event-checklist-dialog";
import { SELECT_CLASS, useCalendarOptions } from "./event-place-fields";
import { FeedDialog } from "./feed-dialog";

const KINDS: EntryKind[] = ["crm_event", "site_event", "class", "pt"];
const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Bulan" },
  { value: "week", label: "Minggu" },
  { value: "day", label: "Hari" },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Rentang jam entri di zona cabangnya: "10.00–11.00" dengan label zona di luar WIB. */
function span(e: CalendarEntry) {
  const clock = (iso: string) => localClock(iso, e.timezone).replace(":", ".");
  return `${clock(e.starts_at)}–${clock(e.ends_at)}${zoneSuffix(e.timezone)}`;
}

/** Event → Kalender Event: event member, event situs, kelas dan PT dalam satu kalender per cabang. */
export function CalendarPage() {
  const params = useSearchParams();
  const initial = params.get("date");
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => (initial && DATE_PATTERN.test(initial) ? initial : todayWib()));
  const [branchId, setBranchId] = useState("");
  const [area, setArea] = useState("");
  const [kinds, setKinds] = useState<EntryKind[]>(KINDS);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [checklist, setChecklist] = useState<CalendarEntry | null>(null);
  const [feeds, setFeeds] = useState(false);

  const options = useCalendarOptions();
  const range = queryRange(view, anchor);
  const entries = useQuery({
    queryKey: [...EVENTS_KEYS.calendar, range.from, range.to, branchId, area, kinds.join(",")],
    queryFn: () => eventsApi.calendar({ ...range, branch_id: branchId || null, area: area || null, kinds }),
    enabled: kinds.length > 0,
  });
  const rows = useMemo(() => (kinds.length > 0 ? (entries.data ?? []) : []), [entries.data, kinds.length]);
  const byDay = useMemo(() => groupByDay(rows), [rows]);
  const days = visibleDays(view, anchor);
  const today = todayWib();
  const month = monthOf(anchor);
  const counts = useMemo(() => {
    const out: Record<EntryKind, number> = { crm_event: 0, site_event: 0, class: 0, pt: 0 };
    for (const e of rows) out[e.kind]++;
    return out;
  }, [rows]);

  const toggleKind = (k: EntryKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const label = view === "month" ? monthLabel(month) : view === "week" ? weekLabel(anchor) : dayLabel(anchor);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Event"
        title="Kalender Event"
        description="Satu kalender untuk event member, event situs, kelas dan PT per cabang, agar sponsor, promo dan ruangan tidak saling bentrok."
        actions={
          <>
            <Button variant="ghost" onClick={() => setFeeds(true)}>
              <Rss /> Langganan ICS
            </Button>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={eventsApi.exportCsvUrl(month, branchId || null)}
              download={`kalender-event-${month}.csv`}
            >
              <Download /> Ekspor CSV {monthLabel(month)}
            </a>
          </>
        }
      />

      <Card size="sm" className="gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-surface p-1" role="tablist" aria-label="Tampilan">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  view === v.value ? "bg-card shadow-card" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Sebelumnya" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(today)}>
              Hari ini
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Berikutnya" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
              <ChevronRight />
            </Button>
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</p>
          <select className={cn(SELECT_CLASS, "w-auto")} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Cabang">
            <option value="">Semua cabang</option>
            {(options.data?.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Input
            list="calendar-area-options"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Semua area"
            aria-label="Area"
            className="w-36"
          />
          <datalist id="calendar-area-options">
            {(options.data?.areas ?? []).map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Jenis">
          {KINDS.map((k) => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition",
                  on ? "border-transparent " + KIND_TONE[k].chip : "border-border text-muted-foreground"
                )}
              >
                <span className={cn("size-2 rounded-full", KIND_TONE[k].bar)} aria-hidden />
                {KIND_LABEL[k]} · {formatNumber(counts[k])}
              </button>
            );
          })}
        </div>
      </Card>

      {entries.error ? (
        <Card>
          <p className="text-sm text-danger">{entries.error.message}</p>
        </Card>
      ) : view === "month" ? (
        <MonthGrid days={days} month={month} today={today} byDay={byDay} loading={entries.isLoading} onPick={setSelected} onDay={(d) => {
          setAnchor(d);
          setView("day");
        }} />
      ) : (
        <div className={cn("grid grid-cols-1 gap-3", view === "week" && "md:grid-cols-7")}>
          {days.map((day) => (
            <DayColumn key={day} day={day} today={today} entries={byDay.get(day) ?? []} loading={entries.isLoading} onPick={setSelected} wide={view === "day"} />
          ))}
        </div>
      )}

      {selected && (
        <EntryDialog
          entry={selected}
          onClose={() => setSelected(null)}
          onChecklist={() => {
            setChecklist(selected);
            setSelected(null);
          }}
        />
      )}
      {checklist && (
        <EventChecklistDialog
          source={checklist.kind === "site_event" ? "site" : "crm"}
          eventId={checklist.id}
          title={checklist.title}
          onClose={() => setChecklist(null)}
        />
      )}
      {feeds && <FeedDialog branches={options.data?.branches ?? []} onClose={() => setFeeds(false)} />}
    </div>
  );
}

function MonthGrid({
  days,
  month,
  today,
  byDay,
  loading,
  onPick,
  onDay,
}: {
  days: string[];
  month: string;
  today: string;
  byDay: Map<string, CalendarEntry[]>;
  loading: boolean;
  onPick: (e: CalendarEntry) => void;
  onDay: (day: string) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const inMonth = monthOf(day) === month;
          const shown = list.slice(0, 3);
          return (
            <div
              key={day}
              className={cn("min-h-24 border-b border-r border-border p-1.5 sm:min-h-28", !inMonth && "bg-surface/60 text-muted-foreground")}
            >
              <button
                type="button"
                onClick={() => onDay(day)}
                className={cn(
                  "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                  day === today && "bg-accent-strong text-accent-foreground"
                )}
                aria-label={dayLabel(day)}
              >
                {Number(day.slice(8, 10))}
              </button>
              {loading ? (
                <p className="text-[11px] text-muted-foreground">…</p>
              ) : (
                <ul className="space-y-1">
                  {shown.map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <button
                        type="button"
                        onClick={() => onPick(e)}
                        className="flex w-full items-center gap-1 truncate rounded-md px-1 py-0.5 text-left text-[11px] hover:bg-surface"
                        title={`${span(e)} ${e.title}`}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", KIND_TONE[e.kind].bar)} aria-hidden />
                        <span className="hidden tabular-nums text-muted-foreground lg:inline">{localClock(e.starts_at, e.timezone).replace(":", ".")}</span>
                        <span className="truncate">{e.title}</span>
                      </button>
                    </li>
                  ))}
                  {list.length > shown.length && (
                    <li>
                      <button type="button" onClick={() => onDay(day)} className="px-1 text-[11px] font-medium text-brand-text">
                        +{list.length - shown.length} lagi
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DayColumn({
  day,
  today,
  entries,
  loading,
  wide,
  onPick,
}: {
  day: string;
  today: string;
  entries: CalendarEntry[];
  loading: boolean;
  wide: boolean;
  onPick: (e: CalendarEntry) => void;
}) {
  return (
    <Card size="sm" variant={day === today ? "default" : "soft"} className="min-w-0 gap-2 p-3">
      <p className={cn("text-sm font-semibold", day === today && "text-brand-text")}>{wide ? dayLabel(day) : shortDayLabel(day)}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Tidak ada agenda</p>
      ) : (
        <ul className={cn("space-y-2", wide && "grid grid-cols-1 gap-2 space-y-0 md:grid-cols-2 xl:grid-cols-3")}>
          {entries.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <button
                type="button"
                onClick={() => onPick(e)}
                className="flex w-full min-w-0 gap-2 rounded-xl bg-card p-2 text-left shadow-card transition hover:ring-2 hover:ring-forest/30"
              >
                <span className={cn("w-1 shrink-0 rounded-full", KIND_TONE[e.kind].bar)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs tabular-nums text-muted-foreground">{span(e)}</span>
                  <span className="block truncate text-sm font-semibold">{e.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[KIND_LABEL[e.kind], e.area, e.coach_name].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  published: "Terbit",
  full: "Penuh",
  requested: "Menunggu konfirmasi",
  confirmed: "Terkonfirmasi",
  completed: "Selesai",
};

function EntryDialog({ entry, onClose, onChecklist }: { entry: CalendarEntry; onClose: () => void; onChecklist: () => void }) {
  const isEvent = entry.kind === "crm_event" || entry.kind === "site_event";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{entry.title}</DialogPanelTitle>
          <DialogPanelDescription>
            {dayLabel(localDay(entry.starts_at, entry.timezone))} · {span(entry)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[entry.kind]}</Badge>
            <Badge variant={entry.status === "draft" || entry.status === "requested" ? "muted" : "success"}>
              {STATUS_LABEL[entry.status] ?? entry.status}
            </Badge>
            {entry.crm_event_id && entry.site_event_id && <Badge variant="info">Tertaut ke situs</Badge>}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>Cabang</dt>
            <dd className="text-foreground">{entry.branch_name ?? "Tanpa cabang"}</dd>
            <dt>Area</dt>
            <dd className="text-foreground">{entry.area ?? "-"}</dd>
            <dt>Coach</dt>
            <dd className="text-foreground">{entry.coach_name ?? "-"}</dd>
            {entry.capacity !== null && (
              <>
                <dt>Terisi</dt>
                <dd className="text-foreground tabular-nums">
                  {formatNumber(entry.confirmed ?? 0)} / {formatNumber(entry.capacity)}
                </dd>
              </>
            )}
          </dl>
        </DialogPanelBody>
        <DialogFooter>
          {isEvent && (
            <Button type="button" variant="secondary" onClick={onChecklist}>
              <ListChecks /> Checklist
            </Button>
          )}
          <Link href={entryHref(entry)} className={buttonVariants({ variant: "outline" })}>
            <CalendarDays /> Buka sumber
          </Link>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
