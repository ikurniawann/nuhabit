"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Flag, Loader2, QrCode, Search, Undo2, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { BOOKING_STATUS_LABEL, sessionEpoch } from "@/lib/studio/booking";
import { addDays, SESSION_STATUS_LABEL } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, MemberOption, RosterRow, SessionRow } from "../types";
import { formatDayLabel, todayIso } from "../types";
import { EmptyState, Pill, StudioPageHeader } from "./ui-bits";

const STATUS_TONE: Record<RosterRow["status"], "positive" | "warning" | "danger" | "neutral" | "brand"> = {
  attended: "brand",
  booked: "positive",
  waitlisted: "warning",
  no_show: "danger",
  late_cancelled: "danger",
  cancelled: "neutral",
};

const SOURCE_LABEL: Record<RosterRow["source"], string> = { front_desk: "Front desk", member_app: "Member App", walk_in: "Walk-in" };

/** Kelas yang paling relevan sekarang: sedang berjalan, lalu yang berikutnya, lalu terakhir. */
function pickCurrent(sessions: SessionRow[]): SessionRow | null {
  const now = Date.now();
  const live = sessions.filter((s) => s.status !== "cancelled");
  const running = live.find((s) => now >= sessionEpoch(s.session_date, s.start_time) - 30 * 60_000 && now <= sessionEpoch(s.session_date, s.end_time));
  if (running) return running;
  const next = live.find((s) => sessionEpoch(s.session_date, s.start_time) > now);
  return next ?? live[live.length - 1] ?? sessions[0] ?? null;
}

export function StudioAttendancePage() {
  const today = todayIso();
  const params = useSearchParams();
  const [date, setDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? (params.get("date") as string) : today));
  const wantedSession = params.get("session");
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelWindow, setCancelWindow] = useState(12);
  const scanRef = useRef<HTMLInputElement>(null);
  const autoPicked = useRef<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiGet<ApiList<SessionRow>>(`/api/studio/sessions?from=${date}&to=${date}`);
      const classes = res.data.filter((s) => s.program_kind === "class");
      setSessions(classes);
      if (autoPicked.current !== date) {
        autoPicked.current = date;
        setSelectedId(classes.find((c) => c.id === wantedSession)?.id ?? pickCurrent(classes)?.id ?? null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat kelas");
      setSessions([]);
    }
  }, [date, wantedSession]);

  const loadRoster = useCallback(async () => {
    if (!selectedId) {
      setRoster(null);
      return;
    }
    try {
      const res = await apiGet<{ data: { session: SessionRow; roster: RosterRow[] } }>(`/api/studio/sessions/${selectedId}/roster`);
      setRoster(res.data.roster);
      setSessions((list) => list?.map((s) => (s.id === selectedId ? { ...s, ...res.data.session } : s)) ?? list);
    } catch {
      setRoster([]);
    }
  }, [selectedId]);

  // Kelas yang sudah lewat diselesaikan otomatis saat halaman dibuka (no-show & revenue).
  useEffect(() => {
    apiPost("/api/studio/sessions/complete-past", {}).catch(() => undefined);
    apiGet<{ data: { cancel_window_hours: number } }>("/api/studio/settings")
      .then((res) => setCancelWindow(res.data.cancel_window_hours))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setSessions(null);
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    setRoster(null);
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    const t = setInterval(() => {
      void loadSessions();
      void loadRoster();
    }, 30_000);
    return () => clearInterval(t);
  }, [loadSessions, loadRoster]);

  const selected = useMemo(() => sessions?.find((s) => s.id === selectedId) ?? null, [sessions, selectedId]);
  const isOpen = selected?.status === "scheduled";

  async function refreshAll() {
    await Promise.all([loadSessions(), loadRoster()]);
  }

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setScanning(true);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/check-in", { code: code.trim(), session_id: isOpen ? selectedId : null });
      setLastScan({ ok: true, text: res.message ?? "Check-in berhasil" });
      setCode("");
      await refreshAll();
    } catch (err) {
      setLastScan({ ok: false, text: err instanceof Error ? err.message : "Gagal check-in" });
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  }

  async function act(id: string, fn: () => Promise<unknown>, success?: string) {
    setBusyId(id);
    try {
      const res = (await fn()) as ApiMessage | undefined;
      toast.success(res?.message ?? success ?? "Tersimpan");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusyId(null);
    }
  }

  function cancel(row: RosterRow) {
    if (!confirm(`Batalkan booking ${row.member_name ?? row.member_phone}?`)) return;
    const late = Boolean(selected) && sessionEpoch(selected!.session_date, selected!.start_time) - Date.now() < cancelWindow * 3_600_000;
    const forgive = late && confirm(`Sudah lewat batas cancel ${cancelWindow} jam, jadi kredit hangus.\n\nOK = tetap kembalikan kredit (pengecualian staf)\nCancel = kredit hangus sesuai aturan`);
    void act(row.id, () => apiPost(`/api/studio/bookings/${row.id}/cancel`, { waive: forgive, reason: "Dibatalkan front desk" }));
  }

  async function complete() {
    if (!selected) return;
    const pending = roster?.filter((r) => r.status === "booked").length ?? 0;
    if (!confirm(`Selesaikan kelas ${selected.program_name} ${selected.start_time}?${pending ? `\n\n${pending} peserta belum check-in akan dicatat tidak hadir (kredit hangus).` : ""}\nRevenue kelas diakui setelah ini.`)) return;
    await act(selected.id, () => apiPost(`/api/studio/sessions/${selected.id}/complete`, {}));
  }

  const active = roster?.filter((r) => ["attended", "booked", "no_show", "late_cancelled"].includes(r.status)) ?? [];
  const waitlist = roster?.filter((r) => r.status === "waitlisted") ?? [];
  const cancelled = roster?.filter((r) => r.status === "cancelled") ?? [];

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader title="Check-in & Booking" subtitle="Scan kode pass atau nomor HP member, kelola peserta per kelas, lalu selesaikan kelas untuk mencatat kehadiran." />

      <form onSubmit={scan} className="mb-6 rounded-xl bg-nh-forest p-4 text-nh-beige shadow-sm sm:p-5">
        <label htmlFor="scan" className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <QrCode className="size-4 text-nh-lime" /> Scan / ketik kode pass (NH-…) atau nomor HP
        </label>
        <div className="flex gap-2">
          <input
            id="scan"
            ref={scanRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="NH-7K2QXM atau 0812…"
            className="nh-dark-input h-12 w-full rounded-xl border px-4 font-mono text-lg outline-none"
          />
          <button
            type="submit"
            disabled={scanning || !code.trim()}
            className="h-12 shrink-0 rounded-full bg-nh-lime px-6 text-sm font-semibold text-nh-forest transition hover:bg-nh-lettuce disabled:opacity-50"
          >
            {scanning ? <Loader2 className="size-4 animate-spin" /> : "Check-in"}
          </button>
        </div>
        <p className="mt-2 text-xs text-nh-beige/60">
          {isOpen && selected
            ? `Belum booking? Member otomatis didaftarkan walk-in ke ${selected.program_name} ${selected.start_time} bila masih ada kursi.`
            : "Pilih kelas yang sedang dibuka untuk menerima walk-in."}
        </p>
        {lastScan && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${lastScan.ok ? "bg-nh-lime text-nh-forest" : "bg-destructive/20 text-nh-beige"}`} role="status">
            {lastScan.text}
          </p>
        )}
      </form>

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Hari sebelumnya" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setDate(today)}>Hari ini</Button>
        <Button variant="outline" size="icon" aria-label="Hari berikutnya" onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="ml-1 font-display text-lg font-semibold capitalize text-foreground">{formatDayLabel(date)}</span>
      </div>

      {sessions === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState title="Tidak ada kelas di tanggal ini" description="Generate jadwal dari Template Mingguan di halaman Jadwal Kelas." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ul className="space-y-2">
            {sessions.map((s) => {
              const taken = s.booked_count ?? 0;
              const pct = Math.min((taken / s.capacity) * 100, 100);
              const on = s.id === selectedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${on ? "border-nh-forest bg-nh-forest text-nh-beige" : "border-border bg-card hover:border-ring"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold tabular-nums">{s.start_time}–{s.end_time}</span>
                      {s.status !== "scheduled" && (
                        <span className={`text-[10px] font-semibold uppercase ${on ? "text-nh-lime" : "text-muted-foreground"}`}>{SESSION_STATUS_LABEL[s.status]}</span>
                      )}
                    </div>
                    <p className={`truncate font-display font-semibold ${s.status === "cancelled" ? "line-through" : ""}`}>{s.program_name}</p>
                    <p className={`truncate text-xs ${on ? "text-nh-beige/70" : "text-muted-foreground"}`}>{s.coach_name ?? "Tanpa coach"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className={`h-1.5 flex-1 rounded-full ${on ? "bg-nh-beige/15" : "bg-muted"}`}>
                        <div className={`h-full rounded-full ${on ? "bg-nh-lime" : "bg-nh-forest"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums">
                        {taken}/{s.capacity}
                        {s.waitlist_count ? ` · +${s.waitlist_count}` : ""}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            {!selected ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Pilih kelas.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">{selected.program_name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selected.start_time}–{selected.end_time} · {selected.coach_name ?? "Tanpa coach"} · {selected.attended_count ?? 0} hadir dari {selected.booked_count ?? 0}/{selected.capacity}
                    </p>
                  </div>
                  {isOpen && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setShowAdd(true)}>
                        <UserPlus className="size-4" /> Tambah peserta
                      </Button>
                      <Button onClick={complete} disabled={busyId === selected.id}>
                        <Flag className="size-4" /> Selesaikan kelas
                      </Button>
                    </div>
                  )}
                </div>

                {roster === null ? (
                  <div className="flex justify-center py-10 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : active.length + waitlist.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">Belum ada peserta.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {active.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">{r.member_name ?? "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.member_phone} · {r.pass_code ?? "tanpa pass"}
                            {r.class_left !== null ? ` · sisa ${r.class_left}` : ""} · {SOURCE_LABEL[r.source]}
                            {r.checked_in_at ? ` · masuk ${new Date(r.checked_in_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : ""}
                          </p>
                        </div>
                        <Pill tone={STATUS_TONE[r.status]}>{BOOKING_STATUS_LABEL[r.status]}</Pill>
                        {isOpen && (
                          <div className="flex gap-1">
                            {r.status === "booked" && (
                              <Button size="sm" disabled={busyId === r.id} onClick={() => act(r.id, () => apiPost(`/api/studio/bookings/${r.id}/check-in?override=1`, {}))}>
                                <CheckCircle2 className="size-3.5" /> Hadir
                              </Button>
                            )}
                            {r.status === "attended" && (
                              <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act(r.id, () => apiDelete(`/api/studio/bookings/${r.id}/check-in`))}>
                                <Undo2 className="size-3.5" /> Batal hadir
                              </Button>
                            )}
                            {r.status === "booked" && (
                              <Button size="sm" variant="ghost" aria-label="Batalkan booking" disabled={busyId === r.id} onClick={() => cancel(r)}>
                                <XCircle className="size-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                    {waitlist.length > 0 && (
                      <li className="pt-4">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waitlist</p>
                        <ul>
                          {waitlist.map((r, i) => (
                            <li key={r.id} className="flex items-center gap-3 py-2">
                              <span className="grid size-6 place-items-center rounded-full bg-nh-ochre/25 text-xs font-semibold text-nh-forest">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                {r.member_name ?? r.member_phone} <span className="text-xs text-muted-foreground">· {SOURCE_LABEL[r.source]}</span>
                              </span>
                              {isOpen && (
                                <Button size="sm" variant="ghost" aria-label="Keluarkan dari waitlist" disabled={busyId === r.id} onClick={() => act(r.id, () => apiPost(`/api/studio/bookings/${r.id}/cancel`, { reason: "Dikeluarkan front desk" }))}>
                                  <XCircle className="size-3.5 text-destructive" />
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    )}
                  </ul>
                )}
                {cancelled.length > 0 && (
                  <p className="mt-4 text-xs text-muted-foreground">{cancelled.length} booking dibatalkan (kredit dikembalikan).</p>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {showAdd && selected && (
        <AddParticipantDialog
          session={selected}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void refreshAll();
          }}
        />
      )}
    </div>
  );
}

function AddParticipantDialog({ session, onClose, onAdded }: { session: SessionRow; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  const [busy, setBusy] = useState(false);
  const started = Date.now() >= sessionEpoch(session.session_date, session.start_time) - 60 * 60_000;

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<{ data: MemberOption[] }>(`/api/studio/members?q=${encodeURIComponent(q.trim())}`)
        .then((res) => setResults(res.data))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function add(m: MemberOption, checkIn: boolean) {
    setBusy(true);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/bookings", { session_id: session.id, customer_id: m.id, check_in: checkIn });
      toast.success(res.message ?? "Peserta ditambahkan");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menambah peserta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah peserta · {session.program_name} {session.start_time}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" autoFocus placeholder="Cari nama atau nomor HP" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{q.trim().length < 2 ? "Ketik minimal 2 huruf" : "Member tidak ditemukan"}</li>}
          {results.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{m.name ?? "Tanpa nama"}</span>
                <span className="text-xs text-muted-foreground">{m.phone}{m.active_passes ? ` · ${m.active_passes} pass aktif` : " · tanpa pass aktif"}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => add(m, false)}>Booking</Button>
                {started && (
                  <Button size="sm" disabled={busy} onClick={() => add(m, true)}>Hadir</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Kredit diambil dari pass yang paling cepat berakhir. Member tanpa pass aktif perlu dibelikan pass dulu di Member Pass.</p>
      </DialogContent>
    </Dialog>
  );
}
