"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import {
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
}

interface LeaveData {
  today: string;
  rules: NoticeRules;
  leaves: LeaveRow[];
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

const EMPTY_FORM = { leave_type: "annual" as LeaveType, start: "", end: "", reason: "" };
const MIN_REASON = 10;
// nh-dark-input: penawar aturan global input terang di globals.css.
const inputClass = "nh-dark-input w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition [color-scheme:dark]";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? body.message ?? "Terjadi kesalahan");
  return body as T;
}

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
  const canSubmit = Boolean(rangeKey) && reasonOk && notice?.ok === true && !submitting;

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
        body: JSON.stringify({ leave_type: form.leave_type, start_date: form.start, end_date: form.end, reason: form.reason.trim() }),
      });
      setMsg(
        r.data?.is_short_notice && r.message
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
      <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-base font-semibold">Ajukan cuti</h2>
        <p className="mt-1 text-xs text-nh-beige/60">Ajukan jauh hari sesuai SOP. Kelas dan sesi Personal Training di tanggal cuti perlu pengganti sebelum cuti disetujui.</p>

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
                      </p>
                      <p className="text-xs text-nh-beige/60">
                        {rangeLabel(l.start_date, l.end_date)} · {Number(l.total_days)} hari kerja
                      </p>
                      {l.status === "rejected" && l.rejection_reason && (
                        <p className="mt-1 text-xs text-red-200">Alasan ditolak: {l.rejection_reason}</p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.className}`}>{st.label}</span>
                  </div>
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
