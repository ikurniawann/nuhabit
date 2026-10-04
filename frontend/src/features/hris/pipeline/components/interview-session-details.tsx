"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { useInterviewRecordings } from "../queries";
import type { InterviewAiSession } from "../types";

const RELEVANSI_LABELS: Record<string, string> = {
  relevan: "Relevan",
  cukup_relevan: "Cukup Relevan",
  kurang_relevan: "Kurang Relevan",
};

function BulletList({ title, titleClass, items }: { title: string; titleClass: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold ${titleClass}`}>{title}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Kartu kesimpulan AI satu sesi interview. */
export function AiSummaryCard({ session }: { session: InterviewAiSession }) {
  const summary = session.ai_summary;
  if (!summary) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        Interview selesai, tetapi kesimpulan AI gagal dibuat. Baca transkrip di bawah untuk menilai
        manual.
      </p>
    );
  }
  return (
    <div className="space-y-2.5 rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-medium text-violet-900 dark:text-violet-200">Kesimpulan AI</span>
        <span
          title="Skor relevansi kandidat terhadap posisi (0–100)"
          className={`ml-auto rounded-md px-2 py-0.5 text-sm font-bold ${scoreBadgeClass(summary.relevansi.skor)}`}
        >
          {summary.relevansi.skor}
          <span className="text-[11px] font-medium opacity-70">/100</span>
        </span>
        <span className="text-xs font-semibold text-foreground">
          {RELEVANSI_LABELS[summary.relevansi.kesimpulan] ?? summary.relevansi.kesimpulan}
        </span>
      </div>
      <p className="text-sm text-foreground">{summary.ringkasan}</p>
      <p className="text-xs text-muted-foreground">{summary.relevansi.alasan}</p>
      {summary.keahlian.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.keahlian.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
            >
              {skill}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-foreground">
        <span className="font-semibold">Ekspektasi gaji:</span>{" "}
        {summary.ekspektasi_gaji.disebutkan ? (summary.ekspektasi_gaji.nilai ?? "disebutkan") : "tidak disebutkan"}
        {summary.ekspektasi_gaji.catatan && (
          <span className="text-muted-foreground"> — {summary.ekspektasi_gaji.catatan}</span>
        )}
      </p>
      <BulletList title="Red flags" titleClass="text-red-700 dark:text-red-400" items={summary.red_flags} />
      <BulletList
        title="Perhatikan saat interview lanjutan"
        titleClass="text-muted-foreground"
        items={summary.perhatikan_saat_interview_lanjutan}
      />
      <p className="border-t border-border pt-2 text-[11px] italic text-muted-foreground">{summary.keterbatasan}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rekaman video penuh sesi interview: dimuat saat bagian dibuka. */
export function RecordingsSection({ sessionId }: { sessionId: string }) {
  const [opened, setOpened] = useState(false);
  const recordings = useInterviewRecordings(opened ? sessionId : null);
  const items = recordings.data ?? [];

  return (
    <details className="rounded-lg border border-border" onToggle={(e) => setOpened(e.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground/80">
        Rekaman video interview
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {recordings.isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Memuat rekaman…
          </p>
        ) : recordings.isError ? (
          <p className="text-xs text-red-600 dark:text-red-400">Gagal memuat rekaman.</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Belum ada rekaman video — rekaman tersedia utk sesi yang dikerjakan setelah fitur ini aktif.
          </p>
        ) : (
          items.map((rec, i) => (
            <div key={rec.path} className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                Bagian {i + 1} · {formatBytes(rec.size)} · {formatDateTime(rec.modified_at)}
              </p>
              <video
                controls
                preload="none"
                src={`/api/interview/files/${rec.path}`}
                className="aspect-video w-full rounded-lg border border-border bg-black"
              />
            </div>
          ))
        )}
      </div>
    </details>
  );
}

/** Transkrip tanya-jawab satu sesi (collapsible) + pemutar rekaman suara. */
export function TranscriptSection({ session }: { session: InterviewAiSession }) {
  const answered = session.turns.filter((t) => t.answered_at);
  if (answered.length === 0) return null;
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground/80">
        Transkrip interview ({answered.length} tanya-jawab)
      </summary>
      <div className="max-h-96 space-y-3 overflow-y-auto border-t border-border p-3">
        {answered.map((turn) => (
          <div key={turn.id} className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              <span className="mr-1 text-xs text-muted-foreground">#{turn.turn_no}</span>
              {turn.question}
            </p>
            <p className="text-muted-foreground">{turn.answer_transcript || "(tidak menjawab)"}</p>
            {turn.answer_mode === "voice" && turn.answer_audio_path && (
              <audio
                controls
                preload="none"
                src={`/api/interview/files/${turn.answer_audio_path}`}
                className="h-8 w-full"
              />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
