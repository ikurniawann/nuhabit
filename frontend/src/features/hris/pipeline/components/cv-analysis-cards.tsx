"use client";

import { Bot, FileText, GraduationCap, Loader2, Mail, Phone, RefreshCw, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cvPreviewKind } from "@/lib/recruitment/pipeline-stage-rules";
import { useRunAiAnalysis } from "../mutations";
import type { CandidateAiAnalysis } from "../types";

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-600 bg-emerald-50 ring-emerald-200";
  if (score >= 50) return "text-amber-600 bg-amber-50 ring-amber-200";
  return "text-red-600 bg-red-50 ring-red-200";
}

/** Preview CV yang diupload (PDF di iframe, gambar inline). */
export function CvPreviewCard({ cvUrl }: { cvUrl: string | null | undefined }) {
  const kind = cvPreviewKind(cvUrl);
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <FileText className="size-4 text-muted-foreground" /> Lampiran CV
        </h4>
        {cvUrl && (
          <a
            href={cvUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Buka di tab baru
          </a>
        )}
      </div>
      {!cvUrl ? (
        <p className="text-sm text-muted-foreground">Belum ada CV yang diupload.</p>
      ) : kind === "pdf" ? (
        <iframe src={cvUrl} title="Preview CV" className="h-[420px] w-full rounded-lg border border-border bg-muted" />
      ) : kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cvUrl}
          alt="Preview CV"
          className="max-h-[420px] w-full rounded-lg border border-border bg-muted object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Preview tidak tersedia untuk format ini — gunakan tombol &quot;Buka di tab baru&quot;.
        </p>
      )}
    </div>
  );
}

function ExtractedField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="break-words text-sm text-foreground">{value || "—"}</div>
      </div>
    </div>
  );
}

/** Analisis CV oleh AI (DeepSeek): ekstraksi data, ringkasan, skor kecocokan. */
export function CvAnalysisCard({
  candidateId,
  hasCv,
  analysis,
  loading,
}: {
  candidateId: string;
  hasCv: boolean;
  analysis: CandidateAiAnalysis | null | undefined;
  loading: boolean;
}) {
  const runAnalysis = useRunAiAnalysis();
  const extracted = analysis?.extracted;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Bot className="size-4 text-sky-500" /> Analisis CV (AI)
        </h4>
        <Button
          size="sm"
          variant={analysis ? "outline" : "default"}
          disabled={!hasCv || runAnalysis.isPending}
          onClick={() => runAnalysis.mutate(candidateId)}
        >
          {runAnalysis.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Menganalisis…
            </>
          ) : analysis ? (
            <>
              <RefreshCw className="size-3.5" /> Analisis Ulang
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" /> Analisis CV
            </>
          )}
        </Button>
      </div>

      {runAnalysis.isError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {runAnalysis.error instanceof Error ? runAnalysis.error.message : "Analisis gagal"}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Memuat analisis…
        </div>
      ) : !analysis ? (
        <p className="text-sm text-muted-foreground">
          Belum dianalisis. Klik &quot;Analisis CV&quot; untuk mengekstrak data CV dan menilai
          kecocokan dengan posisi yang dilamar.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-bold ring-4 ${scoreColor(analysis.match_score ?? 0)}`}
            >
              {analysis.match_score ?? "?"}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Skor Kecocokan CV vs Posisi</div>
              <p className="text-xs text-muted-foreground">{analysis.match_reason}</p>
            </div>
          </div>

          {analysis.summary && (
            <div className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm leading-relaxed text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
              {analysis.summary}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ExtractedField icon={User} label="Nama" value={extracted?.nama} />
            <ExtractedField icon={Mail} label="Email" value={extracted?.email} />
            <ExtractedField icon={Phone} label="No HP" value={extracted?.no_hp} />
            <ExtractedField icon={Sparkles} label="Sumber" value={extracted?.sumber} />
            <ExtractedField icon={GraduationCap} label="Pendidikan" value={extracted?.pendidikan} />
            <ExtractedField icon={FileText} label="Pengalaman" value={extracted?.pengalaman} />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Model {analysis.model} · dianalisis {formatDateTime(analysis.updated_at)}
            {extracted?.metode_ekstraksi === "ocr" ? " · via OCR" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
