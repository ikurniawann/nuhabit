"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { savePortalAnswers, finishPortalTest } from "../api";
import { useCountdown, formatCountdown } from "../hooks/use-countdown";
import type { PortalTestStartData } from "../types";

interface PapiRunnerProps {
  token: string;
  data: PortalTestStartData;
  onFinished: () => void;
}

/**
 * Runner PAPI Kostick (forced choice): satu pasangan per layar, pilih A/B
 * lalu otomatis lanjut. Autosave tiap pilihan; auto-submit saat waktu habis.
 */
export function PapiRunner({ token, data, onFinished }: PapiRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(data.saved_answers);
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
  const firstUnansweredIndex = useMemo(() => {
    const i = questions.findIndex((q) => !answers[q.id]);
    return i === -1 ? questions.length - 1 : i;
  }, [questions, answers]);
  const [index, setIndex] = useState(firstUnansweredIndex);

  const question = questions[index];
  const pair =
    question && !Array.isArray(question.options)
      ? (question.options as { a: { text: string }; b: { text: string } })
      : null;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= questions.length;

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

  const choose = (key: "a" | "b") => {
    if (!question || locked) return;
    const next = { ...answers, [question.id]: key };
    answersRef.current = next;
    setAnswers(next);
    void savePortalAnswers(token, data.test.id, { [question.id]: key }).catch(() => undefined);
    if (index < questions.length - 1) {
      // satu timer maju yang aktif — double-tap tidak boleh melompati pasangan
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => setIndex((i) => i + 1), 120);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{data.test.instrument.name}</div>
        {remaining !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${remaining <= 120 ? "bg-red-100 text-red-700" : "bg-muted text-foreground"}`}
          >
            <Clock className="size-3.5" /> {formatCountdown(remaining)}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <Progress value={(answeredCount / Math.max(1, questions.length)) * 100} />
        <p className="text-xs text-muted-foreground">
          {answeredCount}/{questions.length} pasangan
        </p>
      </div>

      {pair && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pilih satu pernyataan yang paling menggambarkan diri Anda:
          </p>
          {(
            [
              ["a", pair.a.text],
              ["b", pair.b.text],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              disabled={locked}
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-4 text-left text-sm transition-colors disabled:opacity-60 ${
                answers[question.id] === key
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                {key}
              </span>
              {text}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            Sebelumnya
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            disabled={index >= questions.length - 1}
          >
            Berikutnya
          </Button>
        </div>
        <Button type="button" onClick={handleFinish} disabled={finishing || !allAnswered}>
          {finishing && <Loader2 className="size-4 animate-spin" />}
          Selesaikan Tes
        </Button>
      </div>
    </Card>
  );
}
