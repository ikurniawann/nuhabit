"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { useRequestPsikotesAiInsight } from "../mutations";
import type { DrawingAiInsightRecord } from "../types";

const MIN_OBSERVATION_CHARS = 20;

function InsightResult({ insight: record }: { insight: DrawingAiInsightRecord }) {
  const { insight } = record;
  return (
    <div className="space-y-2.5 rounded-md border border-border bg-background p-3 text-sm">
      <p className="text-foreground">{insight.ringkasan}</p>
      {insight.indikasi.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Indikasi</p>
          <ul className="space-y-1">
            {insight.indikasi.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                <span className="font-medium">{item.aspek}:</span> {item.insight}
              </li>
            ))}
          </ul>
        </div>
      )}
      {insight.perhatikan_saat_interview.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Perhatikan saat interview</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {insight.perhatikan_saat_interview.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="border-t border-border pt-2 text-[11px] italic text-muted-foreground">{insight.keterbatasan}</p>
      <p className="text-[11px] text-muted-foreground">
        {record.observation_source === "ai"
          ? `gambar dibaca ${record.vision_model ?? "AI vision"} → insight ${record.model}`
          : `observasi manual → insight ${record.model}`}{" "}
        · diminta {record.created_by_name} · {formatDateTime(record.created_at)}
      </p>
    </div>
  );
}

/**
 * Insight AI tes gambar. Observasi kosong = mode otomatis (AI vision membaca
 * gambar); terisi = observasi manual HR. Indikatif, bukan keputusan final.
 */
export function DrawingInsightPanel({
  testId,
  candidateId,
  existing,
}: {
  testId: string;
  candidateId: string;
  existing: DrawingAiInsightRecord | null;
}) {
  const aiInsight = useRequestPsikotesAiInsight();
  const [observation, setObservation] = useState(existing?.observation ?? "");

  const handleRequest = () => {
    const trimmed = observation.trim();
    if (trimmed && trimmed.length < MIN_OBSERVATION_CHARS) {
      toast.error(
        `Tulis observasi minimal ${MIN_OBSERVATION_CHARS} karakter, atau kosongkan agar AI membaca gambarnya`
      );
      return;
    }
    aiInsight.mutate(
      { testId, candidateId, observation: trimmed || undefined },
      {
        onSuccess: (record) => {
          setObservation(record.observation);
          toast.success("Insight AI dibuat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat insight AI"),
      }
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
        <Label className="text-xs font-medium text-violet-900 dark:text-violet-200">Insight AI (DeepSeek)</Label>
      </div>
      <Textarea
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Opsional — kosongkan agar AI membaca gambarnya langsung, atau tulis observasi Anda sendiri (mis. pohon besar memenuhi kertas, batang tebal, tanpa akar…)."
      />
      <Button type="button" size="sm" variant="outline" onClick={handleRequest} disabled={aiInsight.isPending}>
        {aiInsight.isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Menganalisis…
          </>
        ) : (
          <>
            <Sparkles className="size-4" />
            {existing
              ? "Analisa Ulang oleh AI"
              : observation.trim()
                ? "Analisa Observasi oleh AI"
                : "Analisa Gambar oleh AI"}
          </>
        )}
      </Button>
      {existing && <InsightResult insight={existing} />}
      <p className="text-[11px] text-violet-700 dark:text-violet-300">
        Insight AI bersifat indikatif sebagai bahan pertimbangan — keputusan tetap di tangan HRD
        melalui review manual di bawah.
      </p>
    </div>
  );
}
