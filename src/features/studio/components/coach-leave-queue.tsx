"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api-client";
import { COVER_STATUS_LABEL, coverBlockers, type CoverStatus, type SubstituteCandidate } from "@/lib/studio/coach-cover";
import { type BlackoutPeriod, describeBlackouts, MIN_BLACKOUT_OVERRIDE_REASON } from "@/lib/studio/coach-leave";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/types/hris";
import { formatDayLabel } from "../types";
import { EmptyState, NativeSelect, Pill } from "./ui-bits";

/**
 * Antrean Program Director (EPIC-067 T-067-A4): cuti coach yang menunggu,
 * status pengganti tiap sesi, tunjuk pengganti / putuskan kelas batal, lalu
 * setujui atau tolak. Persetujuan lewat POST /api/hris/leaves/approve.
 */

interface QueueCover {
  id: string;
  status: CoverStatus;
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

interface QueueLeave {
  leaveId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  isShortNotice: boolean;
  noticeDays: number | null;
  coachName: string;
  canDecide: boolean;
  covers: QueueCover[];
  /** Blackout yang berlaku → setujui = pengecualian dengan alasan (T-067-A2). */
  blackouts: BlackoutPeriod[];
}

const TONE: Record<CoverStatus, "positive" | "warning" | "danger" | "neutral"> = {
  open: "danger",
  requested: "neutral",
  accepted: "positive",
  assigned: "positive",
  cancel: "warning",
  void: "neutral",
};

const jam = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export function CoachLeaveQueue() {
  const [leaves, setLeaves] = useState<QueueLeave[] | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ data: QueueLeave[] }>("/api/studio/coach-leave/queue")
        .then((r) => setLeaves(r.data))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat antrean")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Antrean cuti coach</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Cuti mendadak paling atas. Cuti bisa disetujui setelah semua sesi terdampak punya pengganti atau diputuskan batal.</p>
      <div className="mt-4">
        {!leaves ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : leaves.length === 0 ? (
          <EmptyState title="Tidak ada cuti coach yang menunggu" />
        ) : (
          <div className="grid gap-3">
            {leaves.map((l) => (
              <LeaveCard key={l.leaveId} leave={l} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LeaveCard({ leave: l, onChanged }: { leave: QueueLeave; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const blockers = coverBlockers(l.covers).length;
  const inBlackout = l.blackouts.length > 0;
  const overrideOk = !inBlackout || overrideReason.trim().length >= MIN_BLACKOUT_OVERRIDE_REASON;
  const range = l.startDate === l.endDate ? formatDayLabel(l.startDate) : `${formatDayLabel(l.startDate)} – ${formatDayLabel(l.endDate)}`;

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    try {
      await apiPost("/api/hris/leaves/approve", {
        leave_id: l.leaveId,
        action,
        ...(action === "reject" ? { rejection_reason: reason.trim() } : {}),
        ...(action === "approve" && inBlackout ? { blackout_override_reason: overrideReason.trim() } : {}),
      });
      toast.success(
        action === "approve"
          ? inBlackout
            ? "Cuti disetujui sebagai pengecualian blackout — jadwal pengganti diterapkan"
            : "Cuti disetujui — jadwal pengganti diterapkan"
          : "Cuti ditolak"
      );
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={`rounded-lg border p-4 ${inBlackout ? "border-destructive/50 bg-destructive/5" : l.isShortNotice ? "border-nh-ochre/60 bg-nh-ochre/5" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            {l.coachName} · {LEAVE_TYPE_LABELS[l.leaveType] ?? l.leaveType}
          </p>
          <p className="text-sm text-muted-foreground">
            {range} · {l.totalDays} hari kerja
          </p>
          <p className="mt-1 text-sm text-foreground">{l.reason}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {inBlackout && <Pill tone="danger">Masa blackout</Pill>}
          {l.isShortNotice && (
            <Pill tone="warning">Mendadak{l.noticeDays != null ? ` · ${l.noticeDays >= 0 ? `H-${l.noticeDays}` : `${-l.noticeDays} hari terlambat`}` : ""}</Pill>
          )}
        </div>
      </div>
      {inBlackout && (
        <p className="mt-2 text-sm text-destructive">
          Jatuh di tanggal blackout: {describeBlackouts(l.blackouts)}. Hanya bisa disetujui sebagai pengecualian dengan alasan.
        </p>
      )}

      {l.covers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Tidak ada sesi terdampak.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {l.covers.map((c) => (
            <CoverLine key={c.id} cover={c} canDecide={l.canDecide} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {l.canDecide ? (
        <div className="mt-3 grid gap-2">
          {rejecting && (
            <Input placeholder="Alasan penolakan" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Alasan penolakan" />
          )}
          {!rejecting && inBlackout && (
            <Input
              placeholder={`Alasan pengecualian blackout (minimal ${MIN_BLACKOUT_OVERRIDE_REASON} karakter)`}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              aria-label="Alasan pengecualian blackout"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!rejecting ? (
              <>
                <Button onClick={() => decide("approve")} disabled={busy !== null || blockers > 0 || !overrideOk}>
                  {busy === "approve" && <Loader2 className="size-4 animate-spin" />} {inBlackout ? "Setujui sebagai pengecualian" : "Setujui cuti"}
                </Button>
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy !== null}>
                  Tolak
                </Button>
                {blockers > 0 && <span className="text-xs text-muted-foreground">{blockers} sesi belum punya pengganti</span>}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => decide("reject")} disabled={busy !== null || reason.trim().length < 5}>
                  {busy === "reject" && <Loader2 className="size-4 animate-spin" />} Kirim penolakan
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Batal
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Hanya Program Director (atau approver cadangan) yang bisa memutus cuti ini.</p>
      )}
    </article>
  );
}

function CoverLine({ cover: c, canDecide, onChanged }: { cover: QueueCover; canDecide: boolean; onChanged: () => Promise<unknown> }) {
  const [mode, setMode] = useState<"assign" | "cancel" | null>(null);
  const [candidates, setCandidates] = useState<SubstituteCandidate[] | null>(null);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function openAssign() {
    setMode("assign");
    try {
      const list = (await apiGet<{ data: SubstituteCandidate[] }>(`/api/studio/coach-leave/covers/${c.id}/candidates`)).data;
      setCandidates(list);
      setChoice(list[0]?.coach_id ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat coach");
      setMode(null);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const res =
        mode === "assign"
          ? await apiPost<{ message?: string }>(`/api/studio/coach-leave/covers/${c.id}/assign`, { substitute_coach_id: choice })
          : await apiPost<{ message?: string }>(`/api/studio/coach-leave/covers/${c.id}/cancel-class`, { reason: reason.trim() });
      toast.success(res.message ?? "Tersimpan");
      setMode(null);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  const detail =
    c.status === "requested" && c.respond_by
      ? `Menunggu ${c.substitute_name} · batas ${jam(c.respond_by)}`
      : c.status === "accepted" || c.status === "assigned"
        ? `Pengganti: ${c.substitute_name}`
        : c.status === "cancel"
          ? `Batal: ${c.cancel_reason ?? "-"}`
          : c.note;

  return (
    <li className="p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {formatDayLabel(c.session_date)} {c.start_time} · {c.program_name}
            {c.program_kind === "pt" ? " · Personal Training" : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {c.booked_count} member booking{detail ? ` · ${detail}` : ""}
          </p>
        </div>
        <Pill tone={TONE[c.status]}>{COVER_STATUS_LABEL[c.status]}</Pill>
      </div>
      {canDecide && !mode && (
        <div className="mt-2 flex gap-3 text-xs font-semibold">
          <button type="button" className="text-nh-forest underline underline-offset-4 dark:text-nh-lime" onClick={openAssign}>
            {c.status === "accepted" || c.status === "assigned" ? "Ganti pengganti" : "Tunjuk pengganti"}
          </button>
          {c.status !== "cancel" && (
            <button type="button" className="text-destructive underline underline-offset-4" onClick={() => setMode("cancel")}>
              Batalkan kelas
            </button>
          )}
        </div>
      )}
      {mode && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === "assign" ? (
            !candidates ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : candidates.length === 0 ? (
              <span className="text-xs text-muted-foreground">Tidak ada coach yang kosong di jam ini.</span>
            ) : (
              <NativeSelect className="max-w-xs" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Coach pengganti">
                {candidates.map((k) => (
                  <option key={k.coach_id} value={k.coach_id}>
                    {k.name} · {k.week_load} sesi minggu ini{k.teaches_program ? " · bawakan program" : ""}
                  </option>
                ))}
              </NativeSelect>
            )
          ) : (
            <Input className="max-w-xs" placeholder="Alasan pembatalan (dikirim ke member)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Alasan pembatalan" />
          )}
          <Button
            size="sm"
            onClick={submit}
            disabled={busy || (mode === "assign" ? !choice : reason.trim().length < 5)}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />} Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
            Batal
          </Button>
        </div>
      )}
    </li>
  );
}
