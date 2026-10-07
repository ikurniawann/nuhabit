"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { InterviewPortalCurrentTurn, InterviewPortalTurn } from "../types";

interface InterviewRoomProps {
  stream: MediaStream;
  maxQuestions: number;
  answeredTurns: InterviewPortalTurn[];
  currentTurn: InterviewPortalCurrentTurn | null;
  recording: boolean;
  error: string | null;
  onReplay: (turn: InterviewPortalCurrentTurn) => void;
  /** Kontrol jawab pertanyaan aktif. */
  children: ReactNode;
}

/** Layar interview berjalan: self-view, riwayat tanya-jawab, pertanyaan aktif. */
export function InterviewRoom({
  stream,
  maxQuestions,
  answeredTurns,
  currentTurn,
  recording,
  error,
  onReplay,
  children,
}: InterviewRoomProps) {
  const questionNumber = currentTurn?.turn_no ?? answeredTurns.length;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Interview Online dengan AI</h1>
          <p className="text-xs text-muted-foreground">
            Pertanyaan {questionNumber} · maks {maxQuestions}
          </p>
        </div>
        {/* Self-view + indikator rekam */}
        <div className="relative">
          <video
            ref={(el) => {
              if (el && el.srcObject !== stream) el.srcObject = stream;
            }}
            autoPlay
            muted
            playsInline
            className="h-24 w-32 rounded-lg border border-border bg-black object-cover"
          />
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <span className={`size-1.5 rounded-full ${recording ? "animate-pulse bg-red-500" : "bg-emerald-400"}`} />
            {recording ? "REC" : "ON CAM"}
          </span>
        </div>
      </div>

      {answeredTurns.length > 0 && (
        <Card className="max-h-56 space-y-3 overflow-y-auto p-4">
          {answeredTurns.map((t) => (
            <div key={t.id} className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                <span className="mr-1 text-xs text-muted-foreground">#{t.turn_no}</span>
                {t.question}
              </p>
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                <span className="line-clamp-3">{t.answer_transcript || "(tidak menjawab)"}</span>
              </p>
            </div>
          ))}
        </Card>
      )}

      {currentTurn ? (
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-base font-medium text-foreground">{currentTurn.question}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              title="Putar ulang suara pertanyaan"
              onClick={() => onReplay(currentTurn)}
            >
              <Volume2 className="size-4" />
            </Button>
          </div>
          {children}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </Card>
      ) : (
        <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Menyiapkan pertanyaan…
        </Card>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        Jawaban suara Anda direkam & ditranskrip otomatis. Tetap di halaman ini sampai interview
        selesai.
      </p>
    </div>
  );
}
