"use client";

import { CheckCircle2, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isTerminalTest, type PortalTest } from "../types";

interface TestListProps {
  tests: PortalTest[];
  error: string | null;
  finishFailed: boolean;
  onStartTest: (test: PortalTest) => void;
  onRetryFinish: () => void;
}

/** Rangkaian tes saat sesi berjalan: mulai/lanjutkan tiap instrumen. */
export function TestList({ tests, error, finishFailed, onStartTest, onRetryFinish }: TestListProps) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Rangkaian Tes Anda</h1>
        <p className="text-sm text-muted-foreground">
          Kerjakan satu per satu sampai semua selesai. Timer berjalan begitu tes dimulai.
        </p>
      </div>

      <Card className="divide-y divide-border p-0">
        {tests.map((test) => {
          const done = isTerminalTest(test);
          const resumable = test.status === "in_progress";
          return (
            <div key={test.id} className="flex items-center gap-3 px-4 py-3">
              {done ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
              ) : (
                <Clock className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{test.instrument.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(test.instrument.duration_seconds / 60)} menit
                  {done && " · selesai"}
                  {resumable && " · sedang berjalan"}
                </div>
              </div>
              {!done && (
                <Button type="button" size="sm" onClick={() => onStartTest(test)}>
                  {resumable ? "Lanjutkan" : "Mulai"} <ChevronRight className="size-4" />
                </Button>
              )}
            </div>
          );
        })}
      </Card>

      {finishFailed && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">Semua tes selesai, tetapi penutupan sesi gagal terkirim.</p>
          <Button type="button" size="sm" onClick={onRetryFinish}>
            Coba Lagi
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
