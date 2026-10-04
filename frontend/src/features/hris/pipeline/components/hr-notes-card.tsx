"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { useAddCandidateNote } from "../mutations";
import type { CandidateNote } from "../types";

/**
 * Catatan internal HR (timeline) + input catatan baru. Render dgn
 * `key={candidateId}` supaya draft kosong lagi saat ganti kandidat.
 */
export function HrNotesCard({
  candidateId,
  notes,
  loading,
}: {
  candidateId: string;
  notes: CandidateNote[];
  loading: boolean;
}) {
  const addNote = useAddCandidateNote();
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const content = draft.trim();
    if (!content) return;
    addNote.mutate({ id: candidateId, content }, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Catatan Internal HR</h4>
        {notes.length > 0 && <span className="text-xs text-muted-foreground">{notes.length} catatan</span>}
      </div>

      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Tulis catatan baru… (jejak tersimpan per catatan)"
        rows={3}
        className="text-sm"
      />
      {addNote.isError && (
        <p className="mt-1.5 text-xs text-red-600">
          {addNote.error instanceof Error ? addNote.error.message : "Gagal menyimpan catatan"}
        </p>
      )}
      <div className="mt-2">
        <Button size="sm" variant="outline" onClick={handleAdd} disabled={addNote.isPending || !draft.trim()}>
          {addNote.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Tambah Catatan
        </Button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Memuat catatan…
        </div>
      ) : notes.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Belum ada catatan. Catatan pertama akan memulai timeline.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {notes.map((note, idx) => (
            <li key={note.id} className="relative flex gap-3 pb-4 last:pb-0">
              {idx < notes.length - 1 && (
                <span aria-hidden className="absolute top-3 left-[5px] h-full w-px bg-border" />
              )}
              <span
                aria-hidden
                className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-background bg-blue-400 ring-1 ring-border"
              />
              <div className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-xs font-semibold text-foreground/80">{note.created_by_name || "HR"}</span>
                  <time className="text-[11px] text-muted-foreground" dateTime={note.created_at}>
                    {formatDateTime(note.created_at)}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{note.content}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
