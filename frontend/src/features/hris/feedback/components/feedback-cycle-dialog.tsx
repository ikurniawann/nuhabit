"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSaveFeedbackCycle } from "../mutations";
import { CYCLE_STATUSES, cycleToForm, toCyclePayload, validateCycleForm, type CycleForm } from "../view";
import type { FeedbackCycle, FeedbackCycleStatus } from "../types";

interface FeedbackCycleDialogProps {
  open: boolean;
  /** null = siklus baru. */
  cycle: FeedbackCycle | null;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackCycleDialog({ open, cycle, onOpenChange }: FeedbackCycleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cycle ? "Ubah Siklus Feedback" : "Siklus Feedback Baru"}</DialogTitle>
        </DialogHeader>
        {open ? <CycleFormBody key={cycle?.id ?? "new"} cycle={cycle} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const OPTIONS: { key: "is_anonymous" | "allow_self_assessment" | "require_manager_review"; label: string; hint: string }[] = [
  { key: "is_anonymous", label: "Anonim", hint: "Karyawan tidak melihat nama penilainya." },
  { key: "allow_self_assessment", label: "Penilaian diri", hint: "Karyawan ikut menilai dirinya sendiri." },
  { key: "require_manager_review", label: "Wajib disetujui", hint: "Penilaian diri masuk antrean persetujuan HR." },
];

function CycleFormBody({ cycle, onClose }: { cycle: FeedbackCycle | null; onClose: () => void }) {
  const [form, setForm] = useState<CycleForm>(() => cycleToForm(cycle));
  const save = useSaveFeedbackCycle();
  const set = <K extends keyof CycleForm>(key: K, value: CycleForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  function handleSave() {
    const invalid = validateCycleForm(form);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    save.mutate(
      { id: cycle?.id ?? null, payload: toCyclePayload(form) },
      {
        onSuccess: () => {
          toast.success(cycle ? "Siklus diperbarui" : "Siklus dibuat");
          onClose();
        },
        onError: (err) => toast.error(err.message || "Gagal menyimpan siklus"),
      }
    );
  }

  return (
    <>
      <div className="space-y-3">
        <Field id="cycle-name" label="Nama siklus">
          <Input id="cycle-name" value={form.name} placeholder="cth. Review Q4 2026" onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cycle-period" label="Label periode">
            <Input id="cycle-period" value={form.period_label} placeholder="Q4 2026" onChange={(e) => set("period_label", e.target.value)} />
          </Field>
          <Field id="cycle-status" label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v as FeedbackCycleStatus)}>
              <SelectTrigger id="cycle-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CYCLE_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="cycle-start" label="Tanggal mulai">
            <Input id="cycle-start" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field id="cycle-end" label="Tanggal selesai">
            <Input id="cycle-end" type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
          <Field id="cycle-kpi-weight" label="Bobot KPI (%)">
            <Input id="cycle-kpi-weight" type="number" min={0} max={100} value={form.kpi_weight} onChange={(e) => set("kpi_weight", e.target.value)} />
          </Field>
          <Field id="cycle-feedback-weight" label="Bobot Feedback 360° (%)">
            <Input
              id="cycle-feedback-weight"
              type="number"
              min={0}
              max={100}
              value={form.feedback_weight}
              onChange={(e) => set("feedback_weight", e.target.value)}
            />
          </Field>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          {OPTIONS.map((opt) => (
            <div key={opt.key} className="flex items-center justify-between gap-3">
              <div>
                <p id={`cycle-${opt.key}`} className="text-sm font-medium">
                  {opt.label}
                </p>
                <p className="text-xs text-muted-foreground">{opt.hint}</p>
              </div>
              <Switch aria-labelledby={`cycle-${opt.key}`} checked={form[opt.key]} onCheckedChange={(v) => set(opt.key, v)} />
            </div>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
