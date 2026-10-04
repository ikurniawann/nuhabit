"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bot, Download, FileText, Loader2, MessageSquare, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";
import type { TimelineEntry } from "@/lib/recruitment/candidate-timeline";
import type { PipelineStage } from "@/types";
import { useCandidateAiAnalysis } from "@/features/hris/pipeline/queries";
import { useAddCandidateNote } from "../mutations";

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-600 bg-emerald-50 ring-emerald-200";
  if (score >= 50) return "text-amber-600 bg-amber-50 ring-amber-200";
  return "text-red-600 bg-red-50 ring-red-200";
}

export function CandidateAiSummary({ candidateId, status }: { candidateId: string; status: PipelineStage }) {
  const { data: analysis, isLoading } = useCandidateAiAnalysis(candidateId);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Bot className="size-4 text-sky-500" /> Ringkasan AI
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Memuat…
        </div>
      ) : analysis ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-bold ring-4 ${scoreColor(analysis.match_score ?? 0)}`}
            >
              {analysis.match_score ?? "?"}
            </div>
            <p className="text-xs leading-relaxed text-gray-500">{analysis.match_reason}</p>
          </div>
          {analysis.summary && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">{analysis.summary}</p>
          )}
          <p className="text-[10px] text-gray-400">
            {analysis.model} · {formatDateTime(analysis.updated_at)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          Belum dianalisis.{" "}
          {status === "applied" ? "Jalankan dari panel Applied di sebelah kiri." : "Analisis dilakukan di tahap Applied."}
        </p>
      )}
    </div>
  );
}

function DocumentRow({ title, subtitle, tone, onDownload }: { title: string; subtitle?: string; tone: string; onDownload: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <FileText className={`size-7 shrink-0 ${tone}`} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onDownload}>
        <Download className="size-4" />
      </Button>
    </div>
  );
}

interface CandidateDocumentsProps {
  candidateId: string;
  cvUrl?: string | null;
  status: PipelineStage;
  onDownloadCv: () => void;
}

export function CandidateDocuments({ candidateId, cvUrl, status, onDownloadCv }: CandidateDocumentsProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <FileText className="size-4 text-gray-400" /> Dokumen
      </h3>
      <div className="space-y-2">
        {cvUrl ? (
          <DocumentRow
            title="CV / Resume"
            subtitle={cvUrl.split(".").pop()?.toUpperCase()}
            tone="text-red-500"
            onDownload={onDownloadCv}
          />
        ) : (
          <p className="text-sm text-gray-400">CV belum diupload.</p>
        )}
        {/* laporan pipeline (PDF) tersedia mulai tahap Offer */}
        {(status === "offer" || status === "hired") && (
          <DocumentRow
            title="Laporan Pipeline"
            subtitle="PDF · seluruh tahapan yang telah dilalui kandidat"
            tone="text-sky-600"
            onDownload={() => window.open(`/api/candidates/${candidateId}/report`, "_blank")}
          />
        )}
      </div>
    </div>
  );
}

/** Daftar entri timeline dengan garis + titik penanda. */
function TimelineList({ entries, emptyText }: { entries: TimelineEntry[]; emptyText: string }) {
  if (entries.length === 0) return <p className="mt-4 text-sm text-gray-400">{emptyText}</p>;
  return (
    <ol className="mt-4 max-h-[420px] overflow-y-auto pr-1">
      {entries.map((entry, idx) => (
        <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
          {idx < entries.length - 1 && <span aria-hidden className="absolute top-3 left-[5px] h-full w-px bg-gray-200" />}
          <span
            aria-hidden
            className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-white ring-1 ring-gray-200 ${
              entry.kind === "note" ? "bg-amber-400" : "bg-blue-400"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-xs font-semibold text-gray-700">{entry.author}</span>
              <time className="text-[11px] text-gray-400" dateTime={entry.at}>
                {formatDateTime(entry.at)}
              </time>
            </div>
            <p
              className={`mt-0.5 text-sm whitespace-pre-wrap ${
                entry.kind === "note" ? "rounded-lg bg-amber-50/60 px-2.5 py-1.5 text-gray-700" : "text-gray-500"
              }`}
            >
              {entry.text}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface CandidateTimelineProps {
  candidateId: string;
  noteEntries: TimelineEntry[];
  activityEntries: TimelineEntry[];
}

/** Timeline: tab Catatan HR vs Aktivitas pipeline. */
export function CandidateTimeline({ candidateId, noteEntries, activityEntries }: CandidateTimelineProps) {
  const [noteDraft, setNoteDraft] = useState("");
  const addNote = useAddCandidateNote();

  const handleAddNote = async () => {
    if (!noteDraft.trim()) return;
    try {
      await addNote.mutateAsync({ id: candidateId, content: noteDraft.trim() });
      setNoteDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambahkan catatan");
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <MessageSquare className="size-4 text-gray-400" /> Timeline
      </h3>
      <Tabs defaultValue="catatan" className="w-full flex-col">
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger value="catatan">Catatan{noteEntries.length > 0 ? ` (${noteEntries.length})` : ""}</TabsTrigger>
          <TabsTrigger value="aktivitas">
            Aktivitas{activityEntries.length > 0 ? ` (${activityEntries.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catatan" className="mt-3">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Tulis catatan internal…"
            rows={2}
            className="w-full text-sm"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={handleAddNote} disabled={addNote.isPending || !noteDraft.trim()}>
              {addNote.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Tambah Catatan
            </Button>
          </div>
          <TimelineList entries={noteEntries} emptyText="Belum ada catatan. Catatan pertama akan memulai timeline." />
        </TabsContent>

        <TabsContent value="aktivitas" className="mt-3">
          <TimelineList entries={activityEntries} emptyText="Belum ada aktivitas pipeline." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
