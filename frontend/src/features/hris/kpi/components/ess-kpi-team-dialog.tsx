"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { monthYearLabel } from "@/lib/hris/month-label";
import { useSaveKpiRubric } from "../mutations";
import type { KpiIndicatorInfo, KpiScorecardRow } from "../types";
import { ScorecardBreakdown } from "./scorecard-breakdown";

/** Atasan langsung menilai rubrik (1–5) scorecard draft anggota tim. */
export function EssKpiTeamDialog({
  scorecard,
  indicators,
  onClose,
}: {
  scorecard: KpiScorecardRow | null;
  indicators: KpiIndicatorInfo[];
  onClose: () => void;
}) {
  const [rubricValue, setRubricValue] = useState("");
  const [rubricNotes, setRubricNotes] = useState("");
  const rubricMutation = useSaveKpiRubric();

  function save() {
    if (!scorecard || !rubricValue) {
      toast.error("Pilih nilai rubrik 1-5");
      return;
    }
    rubricMutation.mutate(
      {
        employee_id: scorecard.employee_id,
        period_month: scorecard.period_month,
        period_year: scorecard.period_year,
        value: Number(rubricValue),
        notes: rubricNotes || undefined,
      },
      {
        onSuccess: () => {
          setRubricValue("");
          setRubricNotes("");
          onClose();
          toast.success("Penilaian tersimpan — skor diperbarui");
        },
        onError: (error) => toast.error(error.message || "Gagal menyimpan penilaian"),
      }
    );
  }

  return (
    <Dialog open={!!scorecard} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {scorecard?.employee?.full_name} —{" "}
            {scorecard ? monthYearLabel(scorecard.period_month, scorecard.period_year) : ""}
          </DialogTitle>
        </DialogHeader>
        {scorecard && (
          <div className="space-y-4">
            <ScorecardBreakdown scorecard={scorecard} indicators={indicators} />
            {scorecard.status === "draft" ? (
              <div className="space-y-2 border-t pt-4">
                <Label>Penilaian Anda (rubrik 1–5)</Label>
                <div className="flex gap-2">
                  <Select value={rubricValue} onValueChange={setRubricValue}>
                    <SelectTrigger className="w-24">
                      <SelectValue placeholder="Nilai" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={save} disabled={rubricMutation.isPending}>
                    {rubricMutation.isPending ? "Menyimpan..." : "Simpan Penilaian"}
                  </Button>
                </div>
                <Textarea
                  value={rubricNotes}
                  onChange={(event) => setRubricNotes(event.target.value)}
                  placeholder="Catatan penilaian (opsional)"
                />
              </div>
            ) : (
              <p className="border-t pt-4 text-xs text-muted-foreground">
                Scorecard sudah final — penilaian tidak bisa diubah.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
