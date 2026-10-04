"use client";

import { useState } from "react";
import { Keyboard, Loader2, Mic, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AnswerControlsProps {
  sending: boolean;
  recording: boolean;
  recordMs: number;
  typeMode: boolean;
  onTypeModeChange: (typeMode: boolean) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSubmitText: (text: string) => void;
}

const formatRecordTime = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Kontrol jawab satu pertanyaan: rekam suara, atau ketik bila mikrofon bermasalah. */
export function AnswerControls({
  sending,
  recording,
  recordMs,
  typeMode,
  onTypeModeChange,
  onStartRecording,
  onStopRecording,
  onSubmitText,
}: AnswerControlsProps) {
  const [typedAnswer, setTypedAnswer] = useState("");

  if (sending) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memproses jawaban Anda (transkrip & pertanyaan berikutnya)…
      </div>
    );
  }

  if (typeMode) {
    return (
      <div className="space-y-2">
        <Textarea
          value={typedAnswer}
          onChange={(e) => setTypedAnswer(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Ketik jawaban Anda di sini…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => onSubmitText(typedAnswer.trim())} disabled={!typedAnswer.trim()}>
            <Send className="size-4" /> Kirim Jawaban
          </Button>
          <Button type="button" variant="outline" onClick={() => onTypeModeChange(false)}>
            <Mic className="size-4" /> Kembali ke suara
          </Button>
        </div>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          Merekam… {formatRecordTime(recordMs)} (maks 3:00)
        </div>
        <Button type="button" className="w-full" onClick={onStopRecording}>
          <Square className="size-4" /> Selesai & Kirim Jawaban
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" className="w-full" onClick={onStartRecording}>
        <Mic className="size-4" /> Mulai Bicara
      </Button>
      <button
        type="button"
        onClick={() => onTypeModeChange(true)}
        className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <Keyboard className="size-3.5" /> Mikrofon bermasalah? Ketik jawaban
      </button>
    </div>
  );
}
