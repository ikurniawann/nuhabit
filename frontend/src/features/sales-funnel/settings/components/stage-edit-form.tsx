"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateStage } from "../../pipeline/queries";
import type { SalesStage, StageUpdatePayload } from "../../pipeline/types";

interface StageForm {
  name: string;
  sort_order: string;
  stuck_threshold_days: string;
  probability: string;
  is_active: boolean;
}

function stageToForm(stage: SalesStage): StageForm {
  return {
    name: stage.name,
    sort_order: String(stage.sort_order),
    stuck_threshold_days: String(stage.stuck_threshold_days),
    probability: String(stage.probability ?? 0),
    is_active: stage.is_active,
  };
}

/** Isi dialog edit tahap; di-mount ulang per tahap (key) sehingga state awal dari props. */
export function StageEditForm({ stage, onClose }: { stage: SalesStage; onClose: () => void }) {
  const [form, setForm] = useState<StageForm>(() => stageToForm(stage));
  const updateMutation = useUpdateStage(onClose);

  const isClosing = stage.is_won || stage.is_lost;
  const canSubmit = form.name.trim() !== "";

  const handleSubmit = () => {
    if (!canSubmit || updateMutation.isPending) return;
    const values: StageUpdatePayload = {
      name: form.name.trim(),
      sort_order: Number(form.sort_order) || 0,
      stuck_threshold_days: Number(form.stuck_threshold_days) || 0,
      is_active: form.is_active,
      probability: Math.min(100, Math.max(0, Number(form.probability) || 0)),
    };
    updateMutation.mutate({ id: stage.id, values });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Tahap: {stage.name}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="stage_name">Nama Tahap *</Label>
          <Input
            id="stage_name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="stage_sort">Urutan</Label>
            <Input
              id="stage_sort"
              type="number"
              min={0}
              value={form.sort_order}
              onChange={(e) =>
                setForm((p) => ({ ...p, sort_order: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stage_stuck">Ambang Macet (hari)</Label>
            <Input
              id="stage_stuck"
              type="number"
              min={0}
              max={365}
              value={form.stuck_threshold_days}
              onChange={(e) =>
                setForm((p) => ({ ...p, stuck_threshold_days: e.target.value }))
              }
            />
            <p className="text-xs text-gray-500">0 = tanpa badge macet</p>
          </div>
        <div className="space-y-1.5">
          <Label htmlFor="stage_probability">Probability (%) — bobot forecast</Label>
          <Input
            id="stage_probability"
            type="number"
            min={0}
            max={100}
            value={form.probability}
            onChange={(e) => setForm((p) => ({ ...p, probability: e.target.value }))}
            disabled={isClosing}
          />
        </div>
        </div>
        {!isClosing ? (
          <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-gray-900">Tahap aktif</p>
              <p className="text-xs text-gray-500">
                Nonaktif hanya bila tidak ada deal berjalan di tahap ini
              </p>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={(checked) =>
                setForm((p) => ({ ...p, is_active: checked }))
              }
            />
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={updateMutation.isPending}
        >
          Batal
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || updateMutation.isPending}
        >
          {updateMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
        </Button>
      </DialogFooter>
    </>
  );
}
