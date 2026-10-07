"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { ConversationInsight } from "../api";
import { useAnalyzeConversation, useConversationInsight } from "../queries";

/**
 * EPIC-029 — ringkasan AI satu percakapan di panel chat.
 *
 * Hanya MEMBACA cache saat percakapan dibuka (tidak memanggil OpenAI otomatis);
 * analisa baru dijalankan hanya ketika agent menekan tombolnya, supaya membuka
 * inbox tidak menagih token diam-diam.
 */

const SENTIMENT_LABEL: Record<ConversationInsight["sentiment"], string> = {
  positif: "Positif",
  netral: "Netral",
  negatif: "Negatif",
};

const SENTIMENT_STYLE: Record<ConversationInsight["sentiment"], string> = {
  positif: "border-emerald-200 bg-emerald-50 text-emerald-700",
  netral: "border-slate-200 bg-slate-50 text-slate-600",
  negatif: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ConversationInsightCard({ conversationId }: { conversationId: string }) {
  const insightQuery = useConversationInsight(conversationId);
  const analyzeMutation = useAnalyzeConversation(conversationId);
  const [notice, setNotice] = useState<string | null>(null);

  const insight = insightQuery.data ?? null;
  const loading = insightQuery.isLoading;
  const analyzing = analyzeMutation.isPending;
  const failure = analyzeMutation.error ?? insightQuery.error;
  const error = failure instanceof Error ? failure.message : null;

  function ringkas() {
    setNotice(null);
    analyzeMutation.mutate(undefined, {
      onSuccess: ({ empty }) => {
        if (empty) setNotice("Percakapan ini belum punya pesan teks untuk diringkas.");
      },
    });
  }

  return (
    <div className="border-b border-slate-200 bg-violet-50/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
          <Sparkles className="size-3.5" />
          Ringkasan AI
          {loading && <Loader2 className="size-3 animate-spin text-violet-400" />}
        </div>
        <button
          type="button"
          onClick={ringkas}
          disabled={analyzing}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-300 bg-white px-2 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {analyzing ? "Meringkas..." : insight ? "Ringkas ulang" : "Ringkas dengan AI"}
        </button>
      </div>

      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      {notice && <p className="mt-1.5 text-xs text-slate-600">{notice}</p>}

      {!loading && !insight && !error && !notice && (
        <p className="mt-1.5 text-xs text-slate-500">
          Belum ada ringkasan untuk percakapan ini.
        </p>
      )}

      {insight && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs leading-relaxed text-slate-700">
            {insight.summary || "Ringkasan kosong."}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {insight.topic && (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                {insight.topic}
              </span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SENTIMENT_STYLE[insight.sentiment]}`}
            >
              {SENTIMENT_LABEL[insight.sentiment]}
            </span>
            {insight.is_complaint && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Terindikasi komplain
              </span>
            )}
          </div>
          {insight.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {insight.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-sm bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-800"
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
