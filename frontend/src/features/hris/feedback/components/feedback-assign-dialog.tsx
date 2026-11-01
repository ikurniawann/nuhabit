"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEmployeeOptions } from "@/features/hris/shared/use-employee-options";
import { useCreateFeedbackAssignments } from "../mutations";
import { buildAssignments, emptyAssignForm, RELATIONSHIPS, type AssignForm, type ReviewerRow } from "../view";
import type { FeedbackCycle, FeedbackRelationship } from "../types";

interface FeedbackAssignDialogProps {
  open: boolean;
  cycle: FeedbackCycle | null;
  onOpenChange: (open: boolean) => void;
}

const REVIEWER_RELATIONSHIPS = RELATIONSHIPS.filter((r) => r.value !== "self");

export function FeedbackAssignDialog({ open, cycle, onOpenChange }: FeedbackAssignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tugaskan Penilai</DialogTitle>
        </DialogHeader>
        {open && cycle ? <AssignBody cycle={cycle} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AssignBody({ cycle, onClose }: { cycle: FeedbackCycle; onClose: () => void }) {
  const [form, setForm] = useState<AssignForm>(emptyAssignForm);
  const { data: employees = [] } = useEmployeeOptions();
  const create = useCreateFeedbackAssignments();
  const allowSelf = cycle.allow_self_assessment !== false;

  const setReviewer = (index: number, patch: Partial<ReviewerRow>) =>
    setForm((f) => ({ ...f, reviewers: f.reviewers.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));

  function handleSave() {
    let rows;
    try {
      rows = buildAssignments(cycle.id, form, allowSelf);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    create.mutate(rows, {
      onSuccess: () => {
        toast.success(`${rows.length} penugasan dibuat`);
        onClose();
      },
      onError: (err) => toast.error(err.message || "Gagal membuat penugasan"),
    });
  }

  return (
    <>
      <div className="space-y-4">
        <div>
          <label htmlFor="assign-employee" className="mb-1 block text-xs font-medium text-muted-foreground">
            Karyawan yang dinilai
          </label>
          <Combobox
            id="assign-employee"
            options={employees}
            value={form.employee_id}
            onChange={(value) => setForm((f) => ({ ...f, employee_id: value }))}
            placeholder="Pilih karyawan"
          />
        </div>

        {allowSelf ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p id="assign-self" className="text-sm font-medium">
                Sertakan penilaian diri
              </p>
              <p className="text-xs text-muted-foreground">Karyawan juga menilai dirinya sendiri.</p>
            </div>
            <Switch aria-labelledby="assign-self" checked={form.include_self} onCheckedChange={(v) => setForm((f) => ({ ...f, include_self: v }))} />
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Penilai</legend>
          {form.reviewers.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-40 shrink-0">
                <Select value={row.relationship} onValueChange={(v) => setReviewer(index, { relationship: v as FeedbackRelationship })}>
                  <SelectTrigger aria-label={`Hubungan penilai ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVIEWER_RELATIONSHIPS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Combobox
                className="flex-1"
                aria-label={`Penilai ${index + 1}`}
                options={employees}
                value={row.reviewer_id}
                onChange={(value) => setReviewer(index, { reviewer_id: value })}
                placeholder="Pilih penilai"
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Hapus penilai ${index + 1}`}
                onClick={() => setForm((f) => ({ ...f, reviewers: f.reviewers.filter((_, i) => i !== index) }))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm((f) => ({ ...f, reviewers: [...f.reviewers, { relationship: "peer", reviewer_id: "" }] }))}
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah penilai
          </Button>
        </fieldset>

        <div className="max-w-48">
          <label htmlFor="assign-due" className="mb-1 block text-xs font-medium text-muted-foreground">
            Tenggat (opsional)
          </label>
          <Input id="assign-due" type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button onClick={handleSave} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Penugasan"}
        </Button>
      </DialogFooter>
    </>
  );
}
