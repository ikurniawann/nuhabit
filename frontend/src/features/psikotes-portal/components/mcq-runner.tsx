"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { savePortalAnswers, finishPortalTest } from "../api";
import { useCountdown, formatCountdown } from "../hooks/use-countdown";
import type { PortalTestStartData } from "../types";

interface McqRunnerProps {
  token: string;
  data: PortalTestStartData;
  onFinished: () => void;
}

/**
 * Runner soal pilihan ganda: timer server-side (ends_at), autosave tiap
 * pilihan, auto-submit saat waktu habis.
 */
export function McqRunner({ token, data, onFinished }: McqRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(data.saved_answers);
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  // jawaban terbaru utk auto-submit dari tick timer (state bisa basi di closure)
  const answersRef = useRef(answers);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const questions = data.questions;
  const question = questions[index];
  const options = Array.isArray(question?.options) ? question.options : [];
  const answeredCount = Object.keys(answers).length;

  const handleFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await finishPortalTest(token, data.test.id, answersRef.current);
      onFinished();
    } catch {
      setFinishing(false);
    }
  };

  const remaining = useCountdown(data.ends_at, () => void handleFinish());
  const timeUp = remaining !== null && remaining <= 0;

  const locked = finishing || timeUp;

  const choose = (key: string) => {
    if (locked) return;
    const next = { ...answers, [question.id]: key };
    answersRef.current = next;
    setAnswers(next);
    void savePortalAnswers(token, data.test.id, { [question.id]: key }).catch(() => undefined);
    if (index < questions.length - 1) {
      // satu timer maju yang aktif — double-tap tidak boleh melompati soal
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => setIndex((i) => i + 1), 150);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{data.test.instrument.name}</div>
        {remaining !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${remaining <= 60 ? "bg-red-100 text-red-700" : "bg-muted text-foreground"}`}
          >
            <Clock className="size-3.5" /> {formatCountdown(remaining)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setIndex(i)}
            className={`size-8 rounded-md text-xs font-medium transition-colors ${
              i === index
                ? "bg-primary text-primary-foreground"
                : answers[q.id]
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-muted text-muted-foreground"
            }`}
            aria-label={`Soal ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {question && (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-base font-medium text-foreground">
            {question.body}
          </p>
          <div className="grid gap-2">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => choose(option.key)}
                disabled={locked}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:opacity-60 ${
                  answers[question.id] === option.key
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {option.key}
                </span>
                {option.text}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {answeredCount}/{questions.length} terjawab
        </p>
        <Button type="button" onClick={handleFinish} disabled={finishing}>
          {finishing && <Loader2 className="size-4 animate-spin" />}
          Selesaikan Tes
        </Button>
      </div>
    </Card>
  );
}
