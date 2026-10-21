"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Users, X } from "lucide-react";
import { COVER_STATUS_LABEL, type CoverStatus, type SubstituteCandidate } from "@/lib/studio/coach-cover";
import {
  type BlackoutPeriod,
  blackoutConflicts,
  describeBlackouts,
  evaluateLeaveNotice,
  type ImpactedSession,
  NOTICE_LEAVE_TYPES,
  type NoticeRules,
} from "@/lib/studio/coach-leave";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/types/hris";
import { formatDayLabel } from "../types";

/**
 * Tab Cuti di Coach Portal (EPIC-067 T-067-A3): ajukan cuti, lihat sesi yang
 * terdampak sebelum mengirim, dan pantau status pengajuan. Pengajuan lewat
 * POST /api/hris/leaves supaya aturan H-N SOP coach (T-067-A1) tetap satu sumber.
 */

interface LeaveRow {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  /** numeric dari pg → bisa string "1.00". */
  total_days: number | string;
  status: string;
  rejection_reason: string | null;
  is_short_notice: boolean;
  blackout_exception_requested: boolean;
  blackout_override_reason: string | null;
}

/** Baris pengganti per sesi (subset CoverRow dari API). */
interface CoverItem {
  id: string;
  status: CoverStatus;
  original_coach_name: string;
  substitute_name: string | null;
  respond_by: string | null;
  cancel_reason: string | null;
  note: string | null;
  session_date: string;
  start_time: string;
  program_name: string;
  program_kind: string;
  booked_count: number;
}

interface LeaveData {
  today: string;
  rules: NoticeRules;
  blackouts: BlackoutPeriod[];
  leaves: LeaveRow[];
  covers: Record<string, CoverItem[]>;
  incoming: CoverItem[];
}

interface ImpactData {
  sessions: ImpactedSession[];
  summary: { classes: number; pt: number; members: number };
}

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu persetujuan", className: "bg-white/10 text-nh-beige" },
  approved: { label: "Disetujui", className: "bg-nh-lime text-nh-forest" },
  rejected: { label: "Ditolak", className: "bg-red-400/20 text-red-200" },
  cancelled: { label: "Dibatalkan", className: "text-nh-beige/50" },
};

const EMPTY_FORM = { leave_type: "annual" as LeaveType, start: "", end: "", reason: "", exception: false };
const MIN_REASON = 10;
// nh-dark-input: penawar aturan global input terang di globals.css.
const inputClass = "nh-dark-input w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition [color-scheme:dark]";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

const jamBatas = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const sesiLabel = (c: Pick<CoverItem, "session_date" | "start_time" | "program_name" | "program_kind">) =>
  `${formatDayLabel(c.session_date)} ${c.start_time} · ${c.program_name}${c.program_kind === "pt" ? " · Personal Training" : ""}`;

const rangeLabel = (start: string, end: string) => (start === end ? formatDayLabel(start) : `${formatDayLabel(start)} – ${formatDayLabel(end)}`);

export function CoachLeaveTab() {
  const [data, setData] = useState<LeaveData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [impact, setImpact] = useState<{ key: string; data?: ImpactData; error?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  const load = useCallback(
    () =>
      requestJson<{ data: LeaveData }>("/api/coach/leave")
        .then((r) => setData(r.data))
        .catch((e) => setLoadError(e instanceof Error ? e.message : "Gagal memuat")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const rangeKey = form.start && form.end && form.end >= form.start ? `${form.start}|${form.end}` : "";

  useEffect(() => {
    if (!rangeKey) return;
    const [start, end] = rangeKey.split("|");
    let cancelled = false;
    requestJson<{ data: ImpactData }>(`/api/coach/leave/impact?start=${start}&end=${end}`)
      .then((r) => !cancelled && setImpact({ key: rangeKey, data: r.data }))
      .catch((e) => !cancelled && setImpact({ key: rangeKey, error: e instanceof Error ? e.message : "Gagal memuat sesi" }));
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  if (loadError) return <p className="mt-10 text-center text-sm text-red-300">{loadError}</p>;
  if (!data) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-nh-lime" />;

  const rule = data.rules[form.leave_type];
  const notice = form.start ? evaluateLeaveNotice(rule, form.start, data.today) : null;
  const currentImpact = impact && impact.key === rangeKey ? impact : null;
  const reasonOk = form.reason.trim().length >= MIN_REASON;
  const blackouts = rangeKey ? blackoutConflicts(rule, data.blackouts, form.start, form.end) : [];
  const canSubmit = Boolean(rangeKey) && reasonOk && notice?.ok === true && (blackouts.length === 0 || form.exception) && !submitting;

  function setStart(start: string) {
    setForm((f) => ({ ...f, start, end: !f.end || f.end < start ? start : f.end }));
  }

  async function submit() {
    setSubmitting(true);
    setMsg(null);
    try {
      const r = await requestJson<{ message?: string; data?: { is_short_notice?: boolean } }>("/api/hris/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_type: form.leave_type,
          start_date: form.start,
          end_date: form.end,
          reason: form.reason.trim(),
          ...(blackouts.length > 0 ? { blackout_exception: form.exception } : {}),
        }),
      });
      setMsg(
        (r.data?.is_short_notice || blackouts.length > 0) && r.message
          ? { tone: "warn", text: r.message }
          : { tone: "ok", text: "Pengajuan terkirim — menunggu persetujuan." }
      );
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Gagal mengajukan" });
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      await requestJson(`/api/hris/leaves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Gagal membatalkan" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {data.incoming.length > 0 && <IncomingRequests items={data.incoming} onChanged={load} />}

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-base font-semibold">Ajukan cuti</h2>
        <p className="mt-1 text-xs text-nh-beige/60">Ajukan jauh hari sesuai SOP. Kelas dan sesi Personal Training di tanggal cuti perlu pengganti sebelum cuti disetujui.</p>
        {data.blackouts.length > 0 && (
          <div className="mt-3 rounded-2xl bg-black/20 px-3 py-2 text-xs">
            <p className="font-semibold text-nh-beige/80">Tanggal blackout (tidak bisa cuti)</p>
            <ul className="mt-1 space-y-0.5 text-nh-beige/70">
              {data.blackouts.map((b) => (
                <li key={b.id}>
                  {rangeLabel(b.date_from, b.date_to)} · {b.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-nh-beige/80">Jenis cuti</span>
            <select
              className={inputClass}
              value={form.leave_type}
              onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value as LeaveType }))}
            >
              {NOTICE_LEAVE_TYPES.map((t) => (
                <option key={t} value={t} className="bg-nh-forest">
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-nh-beige/80">Mulai</span>
              <input type="date" className={inputClass} value={form.start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-nh-beige/80">Sampai</span>
              <input
                type="date"
                className={inputClass}
                value={form.end}
                min={form.start || undefined}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              />
            </label>
          </div>

          {notice && (
            <p
              className={`flex items-start gap-1.5 text-xs ${notice.ok ? (notice.shortNotice ? "text-amber-200" : "text-nh-beige/60") : "text-red-300"}`}
            >
              {(!notice.ok || notice.shortNotice) && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              <span>
                {!notice.ok
                  ? `${LEAVE_TYPE_LABELS[form.leave_type]} minimal diajukan H-${rule.min_days}. Tanggal mulai paling cepat ${formatDayLabel(notice.earliestStart)}.`
                  : notice.shortNotice
                    ? `Di bawah minimal H-${rule.min_days}: tetap bisa diajukan, tetapi tercatat sebagai cuti mendadak.`
                    : rule.min_days > 0
                      ? `Sesuai SOP (minimal H-${rule.min_days}).`
                      : "Tanpa minimal pemberitahuan."}
              </span>
            </p>
          )}

          {blackouts.length > 0 && (
            <div className="rounded-2xl border border-red-300/40 bg-red-400/10 p-3 text-xs">
              <p className="flex items-start gap-1.5 font-semibold text-red-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>Tanggal blackout: {describeBlackouts(blackouts)}</span>
              </p>
              <p className="mt-1 text-nh-beige/70">
                {LEAVE_TYPE_LABELS[form.leave_type]} tidak bisa diambil di tanggal ini. Pilih tanggal lain, atau minta pengecualian dan jelaskan alasannya
                di bawah — keputusan ada di Program Director.
              </p>
              <label className="mt-2 flex items-start gap-2 text-sm text-nh-beige">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[#daff59]"
                  checked={form.exception}
                  onChange={(e) => setForm((f) => ({ ...f, exception: e.target.checked }))}
                />
                Minta pengecualian ke Program Director
              </label>
            </div>
          )}

          {rangeKey && <ImpactList impact={currentImpact} />}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-nh-beige/80">Alasan</span>
            <textarea
              rows={3}
              className={inputClass}
              placeholder="Contoh: acara keluarga di luar kota"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
            {!reasonOk && form.reason.length > 0 && (
              <span className="mt-1 block text-[11px] text-nh-beige/50">Minimal {MIN_REASON} karakter.</span>
            )}
          </label>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-nh-lime py-3 text-sm font-semibold text-nh-forest transition disabled:opacity-40"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Kirim pengajuan
          </button>
          {msg && (
            <p className={`text-xs ${msg.tone === "error" ? "text-red-300" : msg.tone === "warn" ? "text-amber-200" : "text-nh-lime"}`}>{msg.text}</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-nh-beige/60">Riwayat pengajuan</h2>
        {data.leaves.length === 0 ? (
          <p className="text-sm text-nh-beige/60">Belum ada pengajuan cuti.</p>
        ) : (
          <ul className="space-y-2">
            {data.leaves.map((l) => {
              const st = STATUS[l.status] ?? STATUS.pending;
              return (
                <li key={l.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {LEAVE_TYPE_LABELS[l.leave_type] ?? l.leave_type}
                        {l.is_short_notice && (
                          <span className="ml-2 rounded-full bg-amber-300/20 px-2 py-0.5 align-middle text-[10px] font-semibold text-amber-200">Mendadak</span>
                        )}
                        {l.blackout_exception_requested && (
                          <span className="ml-2 rounded-full bg-red-400/20 px-2 py-0.5 align-middle text-[10px] font-semibold text-red-200">Blackout</span>
                        )}
                      </p>
                      <p className="text-xs text-nh-beige/60">
                        {rangeLabel(l.start_date, l.end_date)} · {Number(l.total_days)} hari kerja
                      </p>
                      {l.blackout_override_reason && (
                        <p className="mt-1 text-xs text-nh-beige/70">Pengecualian blackout: {l.blackout_override_reason}</p>
                      )}
                      {l.status === "rejected" && l.rejection_reason && (
                        <p className="mt-1 text-xs text-red-200">Alasan ditolak: {l.rejection_reason}</p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.className}`}>{st.label}</span>
                  </div>
                  {l.status === "pending" && (data.covers[l.id]?.length ?? 0) > 0 && (
                    <CoverList covers={data.covers[l.id]} onChanged={load} />
                  )}
                  {l.status === "pending" && (
                    <button
                      type="button"
                      disabled={busyId === l.id}
                      onClick={() => cancel(l.id)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-nh-beige/70 underline underline-offset-4 hover:text-nh-beige disabled:opacity-50"
                    >
                      {busyId === l.id && <Loader2 className="size-3 animate-spin" />}
                      Batalkan pengajuan
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ImpactList({ impact }: { impact: { data?: ImpactData; error?: string } | null }) {
  if (!impact) return <Loader2 className="mx-auto size-5 animate-spin text-nh-lime" />;
  if (impact.error) return <p className="text-xs text-red-300">{impact.error}</p>;
  const { sessions, summary } = impact.data!;
  if (sessions.length === 0) {
    return <p className="rounded-2xl bg-white/5 px-3 py-2.5 text-xs text-nh-beige/70">Tidak ada jadwal mengajar di tanggal ini.</p>;
  }
  const parts = [summary.classes > 0 && `${summary.classes} kelas`, summary.pt > 0 && `${summary.pt} Personal Training`].filter(Boolean);
  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-3">
      <p className="text-xs font-semibold text-amber-100">
        Sesi terdampak: {parts.join(" · ")} · {summary.members} member sudah booking
      </p>
      <ul className="mt-2 space-y-1.5">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-nh-beige/70">{formatDayLabel(s.session_date)}</span>
            <span className="w-10 shrink-0 tabular-nums text-nh-beige/70">{s.start_time}</span>
            <span className="min-w-0 flex-1 truncate">
              {s.program_name}
              {s.program_kind === "pt" ? " · Personal Training" : ""}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-nh-beige/60">
              <Users className="size-3" />
              {s.booked_count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const COVER_TONE: Record<CoverStatus, string> = {
  open: "bg-red-400/20 text-red-200",
  requested: "bg-white/10 text-nh-beige",
  accepted: "bg-nh-lime text-nh-forest",
  assigned: "bg-nh-lime text-nh-forest",
  cancel: "bg-amber-300/20 text-amber-200",
  void: "text-nh-beige/50",
};

/** Status pengganti tiap sesi pada cuti yang menunggu + pilih pengganti untuk sesi yang masih kosong (T-067-A4). */
function CoverList({ covers, onChanged }: { covers: CoverItem[]; onChanged: () => Promise<unknown> }) {
  const open = covers.filter((c) => c.status === "open").length;
  return (
    <div className="mt-3 rounded-2xl bg-nh-forest/60 p-3">
      <p className="text-xs font-semibold text-nh-beige/80">
        Pengganti · {covers.length - open}/{covers.length} sesi tertangani
      </p>
      <ul className="mt-2 space-y-2.5">
        {covers.map((c) => (
          <CoverRowItem key={c.id} cover={c} onChanged={onChanged} />
        ))}
      </ul>
      {open > 0 && <p className="mt-2 text-[11px] text-nh-beige/50">Cuti baru bisa disetujui setelah semua sesi punya pengganti.</p>}
    </div>
  );
}

function CoverRowItem({ cover: c, onChanged }: { cover: CoverItem; onChanged: () => Promise<unknown> }) {
  const [candidates, setCandidates] = useState<SubstituteCandidate[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startPick() {
    setPicking(true);
    setErr(null);
    try {
      const list = (await requestJson<{ data: SubstituteCandidate[] }>(`/api/coach/leave/covers/${c.id}/candidates`)).data;
      setCandidates(list);
      setChoice(list[0]?.coach_id ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat coach");
    }
  }

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await requestJson(`/api/coach/leave/covers/${c.id}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substitute_coach_id: choice }),
      });
      setPicking(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengirim");
    } finally {
      setBusy(false);
    }
  }

  const detail =
    c.status === "requested" && c.substitute_name && c.respond_by
      ? `Menunggu ${c.substitute_name} · jawab sebelum ${jamBatas(c.respond_by)}`
      : c.status === "accepted"
        ? `${c.substitute_name} menerima`
        : c.status === "assigned"
          ? `${c.substitute_name} ditunjuk Program Director`
          : c.status === "cancel"
            ? `Diputuskan batal: ${c.cancel_reason ?? "-"}`
            : c.note;

  return (
    <li className="text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-nh-beige">{sesiLabel(c)}</p>
          {detail && <p className="mt-0.5 text-nh-beige/60">{detail}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${COVER_TONE[c.status]}`}>{COVER_STATUS_LABEL[c.status]}</span>
      </div>
      {c.status === "open" && !picking && (
        <button type="button" onClick={startPick} className="mt-1.5 font-semibold text-nh-lime underline underline-offset-4">
          Pilih pengganti
        </button>
      )}
      {picking && (
        <div className="mt-2 space-y-2">
          {!candidates ? (
            <Loader2 className="size-4 animate-spin text-nh-lime" />
          ) : candidates.length === 0 ? (
            <p className="text-amber-200">Tidak ada coach yang kosong di jam ini — Program Director akan menunjuk atau membatalkan kelas.</p>
          ) : (
            <div className="flex gap-2">
              <select className={`${inputClass} py-2 text-xs`} value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Coach pengganti">
                {candidates.map((k) => (
                  <option key={k.coach_id} value={k.coach_id} className="bg-nh-forest">
                    {k.name} · {k.week_load} sesi minggu ini{k.teaches_program ? " · bawakan program ini" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !choice}
                onClick={send}
                className="flex shrink-0 items-center gap-1 rounded-full bg-nh-lime px-3 font-semibold text-nh-forest disabled:opacity-40"
              >
                {busy && <Loader2 className="size-3 animate-spin" />}
                Minta
              </button>
            </div>
          )}
          <button type="button" onClick={() => setPicking(false)} className="text-nh-beige/60 underline underline-offset-4">
            Batal
          </button>
        </div>
      )}
      {err && <p className="mt-1 text-red-300">{err}</p>}
    </li>
  );
}

/** Permintaan menggantikan yang masuk ke coach ini (T-067-A4). */
function IncomingRequests({ items, onChanged }: { items: CoverItem[]; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function respond(id: string, accept: boolean) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await requestJson<{ message?: string }>(`/api/coach/leave/covers/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      setMsg({ tone: "ok", text: r.message ?? "Tersimpan" });
      await onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Gagal menyimpan" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-3xl border border-nh-lime/40 bg-nh-lime/5 p-4">
      <h2 className="font-display text-base font-semibold text-nh-lime">Permintaan menggantikan</h2>
      <ul className="mt-3 space-y-3">
        {items.map((c) => (
          <li key={c.id} className="rounded-2xl bg-nh-forest/60 p-3">
            <p className="text-sm font-semibold">{sesiLabel(c)}</p>
            <p className="mt-0.5 text-xs text-nh-beige/60">
              Menggantikan {c.original_coach_name} · {c.booked_count} member sudah booking
            </p>
            {c.status === "requested" ? (
              <>
                {c.respond_by && <p className="mt-1 text-xs text-amber-200">Jawab sebelum {jamBatas(c.respond_by)}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => respond(c.id, true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-nh-lime py-2 text-xs font-semibold text-nh-forest disabled:opacity-50"
                  >
                    {busy === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Terima
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => respond(c.id, false)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 py-2 text-xs font-semibold text-nh-beige disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                    Tolak
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-nh-lime">
                {c.status === "assigned" ? "Ditunjuk Program Director" : "Anda menerima"} · berlaku setelah cuti disetujui
              </p>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className={`mt-2 text-xs ${msg.tone === "error" ? "text-red-300" : "text-nh-lime"}`}>{msg.text}</p>}
    </section>
  );
}
