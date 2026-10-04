"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  MessageCircle,
  Mic,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { buildWaLink } from "@/lib/recruitment/wa";
import { countDone, type ChecklistEntry } from "@/lib/recruitment/pipeline-stage-rules";
import type { WaTemplate } from "@/lib/recruitment/pipeline-wa-templates";
import type { PipelineStage, ProctorTally, StageRecommendation } from "../types";
import { useLogWaTemplate } from "../mutations";

/** Bagian UI bersama panel aksi tahap pipeline (screening → offer). */

export interface StagePanelCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  positions?: { title: string } | null;
}

export interface StagePanelProps<C extends StagePanelCandidate = StagePanelCandidate> {
  candidate: C;
  onMove: (stage: PipelineStage) => void;
  moving?: boolean;
}

export const positionTitleOf = (candidate: StagePanelCandidate, fallback?: string | null) =>
  candidate.positions?.title ?? fallback ?? "posisi yang dilamar";

function ChecklistItem({ done, label, hint }: ChecklistEntry) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
      )}
      <div>
        <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Checklist dgn ikon + "x/y langkah" (psikotes, interview, offer). */
export function StepChecklistCard({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: ChecklistEntry[];
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {icon} {title}
        </h3>
        <span className="text-xs text-muted-foreground">
          {countDone(items)}/{items.length} langkah
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <ChecklistItem key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

/** Checklist dgn progress bar (applied, screening). */
export function ProgressChecklistCard({
  title,
  items,
  barClassName,
}: {
  title: string;
  items: ChecklistEntry[];
  barClassName: string;
}) {
  const done = countDone(items);
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className="text-xs font-medium text-muted-foreground">
          {done}/{items.length}
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barClassName}`}
          style={{ width: `${(done / items.length) * 100}%` }}
        />
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <ChecklistItem key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

const RECOMMENDATION_OPTIONS: { value: StageRecommendation; label: string; activeClass: string }[] = [
  { value: "lolos", label: "Lolos", activeClass: "bg-emerald-600 text-white border-emerald-600" },
  { value: "hold", label: "Hold", activeClass: "bg-amber-500 text-white border-amber-500" },
  { value: "tidak_lolos", label: "Tidak Lolos", activeClass: "bg-red-600 text-white border-red-600" },
];

/** Pilihan Lolos/Hold/Tidak Lolos; klik ulang = batal pilih. */
export function RecommendationPicker({
  value,
  onChange,
}: {
  value: StageRecommendation | null;
  onChange: (value: StageRecommendation | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {RECOMMENDATION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? null : opt.value)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value
              ? opt.activeClass
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SavedStamp({ by, at }: { by: string | null; at: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      Terakhir disimpan {by || "HR"} · {formatDateTime(at)}
    </span>
  );
}

/** Buka WA berisi template lalu catat aktivitasnya di timeline. */
export function useSendWaTemplate(candidate: StagePanelCandidate, positionTitle: string) {
  const logWa = useLogWaTemplate();
  const send = (template: WaTemplate) => {
    const link = buildWaLink(candidate.phone, template.build(candidate.full_name, positionTitle));
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate(
      { id: candidate.id, template: template.key },
      { onError: () => toast.error("WhatsApp terbuka, tapi aktivitas gagal tercatat di timeline") }
    );
  };
  return { send, isPending: logWa.isPending };
}

export function WaTemplateCard({
  candidate,
  positionTitle,
  templates,
  description,
}: {
  candidate: StagePanelCandidate;
  positionTitle: string;
  templates: WaTemplate[];
  description: string;
}) {
  const wa = useSendWaTemplate(candidate, positionTitle);
  return (
    <div className="rounded-xl border border-border p-4">
      <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <MessageCircle className="size-4 text-emerald-500" /> Template WhatsApp
      </h4>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {!candidate.phone && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Nomor HP kandidat belum diisi — template tidak bisa dikirim.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant="outline"
            disabled={!candidate.phone || wa.isPending}
            onClick={() => wa.send(t)}
          >
            <MessageCircle className="size-3.5 text-emerald-500" /> {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Keputusan tahap: lanjut (digate), Talent Pool, Tolak. */
export function DecisionCard({
  next,
  onMove,
  moving,
  children,
}: {
  next: { stage: PipelineStage; label: string; enabled: boolean; lockedHint: string };
  onMove: (stage: PipelineStage) => void;
  moving: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">Keputusan</h4>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={moving || !next.enabled} onClick={() => onMove(next.stage)}>
          {next.label} <ArrowRight className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-500/10"
          disabled={moving}
          onClick={() => onMove("talent_pool")}
        >
          Simpan ke Talent Pool
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          disabled={moving}
          onClick={() => onMove("rejected")}
        >
          Tolak
        </Button>
        {children}
      </div>
      {!next.enabled && <p className="mt-2 text-xs text-muted-foreground">{next.lockedHint}</p>}
    </div>
  );
}

export function PanelLoading() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-border py-12 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

export function PanelError({
  error,
  fallback,
  onRetry,
}: {
  error: unknown;
  fallback: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-10">
      <p className="text-sm text-red-600 dark:text-red-400">
        {error instanceof Error ? error.message : fallback}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Coba Lagi
      </Button>
    </div>
  );
}

/** Salin link portal kandidat (/psikotes, /interview, /offer + token). */
export async function copyPortalLink(path: string, message: string) {
  await navigator.clipboard.writeText(`${window.location.origin}${path}`).catch(() => undefined);
  toast.success(message);
}

export function CopyLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
    >
      <Copy className="size-3" /> salin link
    </button>
  );
}

/** Baris meta sesi undangan: status, live, tanggal kirim, proctoring, salin link. */
export function InviteSessionMeta({
  statusLabel,
  live,
  invitedAt,
  createdByName,
  proctor,
  onOpenProctor,
  onCopyLink,
}: {
  statusLabel: string;
  live?: boolean;
  invitedAt: string | null;
  createdByName: string | null;
  proctor: ProctorTally;
  onOpenProctor: () => void;
  onCopyLink?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{statusLabel}</span>
      {live && (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Mic className="size-3.5 animate-pulse" /> live
        </span>
      )}
      {invitedAt && (
        <span>
          dikirim {formatDate(invitedAt)}
          {createdByName ? ` oleh ${createdByName}` : ""}
        </span>
      )}
      {(proctor.flags > 0 || proctor.snapshots > 0) && (
        <button
          type="button"
          onClick={onOpenProctor}
          className="inline-flex items-center gap-1 text-amber-600 hover:underline dark:text-amber-400"
        >
          <ShieldAlert className="size-3.5" />
          {proctor.flags} flag · {proctor.snapshots} snapshot
        </button>
      )}
      {onCopyLink && <CopyLinkButton onClick={onCopyLink} />}
    </div>
  );
}
