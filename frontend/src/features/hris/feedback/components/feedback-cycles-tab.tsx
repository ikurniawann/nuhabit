"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/format";
import { useDeleteFeedbackCycle } from "../mutations";
import { cycleProgress, cycleStatusMeta, cycleWeights } from "../view";
import type { FeedbackCycle } from "../types";
import { FeedbackCycleDialog } from "./feedback-cycle-dialog";
import { QueryState } from "./feedback-shared";

interface FeedbackCyclesTabProps {
  cycles: readonly FeedbackCycle[];
  loading: boolean;
  error: Error | null;
  onOpenCycle: (id: string) => void;
}

/** Tab "Siklus": buat, ubah, hapus siklus dan pantau progres pengisian. */
export function FeedbackCyclesTab({ cycles, loading, error, onOpenCycle }: FeedbackCyclesTabProps) {
  const [editing, setEditing] = useState<FeedbackCycle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<FeedbackCycle | null>(null);
  const remove = useDeleteFeedbackCycle();

  function openForm(cycle: FeedbackCycle | null) {
    setEditing(cycle);
    setFormOpen(true);
  }

  function handleDelete() {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success("Siklus dihapus");
        setDeleting(null);
      },
      onError: (err) => toast.error(err.message || "Gagal menghapus siklus"),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => openForm(null)}>
          <Plus className="h-4 w-4" />
          Siklus Baru
        </Button>
      </div>

      <QueryState loading={loading} error={error} empty={cycles.length === 0 ? "Belum ada siklus feedback. Buat siklus pertama untuk mulai." : undefined} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cycles.map((cycle) => {
          const status = cycleStatusMeta(cycle.status);
          const progress = cycleProgress(cycle);
          const weights = cycleWeights(cycle);
          return (
            <Card key={cycle.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="min-w-0 text-left" onClick={() => onOpenCycle(cycle.id)}>
                    <p className="truncate font-semibold hover:underline">{cycle.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {cycle.period_label} · {formatDate(cycle.start_date)} s.d. {formatDate(cycle.end_date)}
                    </p>
                  </button>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Penilaian terkirim</span>
                    <span>
                      {progress.done}/{progress.total} ({progress.percent}%)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`Progres ${cycle.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.percent}
                    className="h-2 overflow-hidden rounded-full bg-surface"
                  >
                    <div className="h-2 rounded-full bg-forest" style={{ width: `${progress.percent}%` }} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  KPI {weights.kpi}% + 360° {weights.feedback}% ·{" "}
                  {cycle.summaries_count[0]?.count ?? 0} hasil karyawan
                  {cycle.is_anonymous ? " · anonim" : ""}
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => openForm(cycle)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Ubah
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Hapus ${cycle.name}`} onClick={() => setDeleting(cycle)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <FeedbackCycleDialog open={formOpen} cycle={editing} onOpenChange={setFormOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus siklus?"
        description={`Siklus "${deleting?.name ?? ""}" beserta semua penugasan, jawaban, dan hasilnya akan dihapus.`}
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
