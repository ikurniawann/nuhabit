"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { INSTRUMENT_KIND_LABELS } from "@/lib/recruitment/psikotes";
import { useUpdateInstrument } from "../mutations";
import type { PsikotesInstrument } from "../types";

interface InstrumentConfigDialogProps {
  instrument: PsikotesInstrument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_DURATION_MINUTES = 240;

/** Pengaturan instrumen: nama, durasi (menit), jumlah soal & acak (mcq), instruksi. */
export function InstrumentConfigDialog({
  instrument,
  open,
  onOpenChange,
}: InstrumentConfigDialogProps) {
  const updateInstrument = useUpdateInstrument();

  const [name, setName] = useState(instrument.name);
  const [durationMinutes, setDurationMinutes] = useState(
    String(Math.max(1, Math.round((instrument.config.duration_seconds ?? 600) / 60)))
  );
  const [questionCount, setQuestionCount] = useState(
    instrument.config.question_count != null ? String(instrument.config.question_count) : ""
  );
  const [shuffle, setShuffle] = useState(instrument.config.shuffle ?? false);
  const [instructions, setInstructions] = useState(instrument.config.instructions ?? "");

  const isMcq = instrument.kind === "mcq";

  const handleSave = () => {
    const minutes = Number(durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DURATION_MINUTES) {
      toast.error(`Durasi harus 1–${MAX_DURATION_MINUTES} menit`);
      return;
    }
    const count = questionCount.trim() === "" ? null : Number(questionCount);
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > 200)) {
      toast.error("Jumlah soal harus 1–200, atau kosongkan untuk semua soal aktif");
      return;
    }
    if (!name.trim()) {
      toast.error("Nama wajib diisi");
      return;
    }

    updateInstrument.mutate(
      {
        id: instrument.id,
        payload: {
          name: name.trim(),
          config: {
            duration_seconds: minutes * 60,
            question_count: isMcq ? count : undefined,
            shuffle: isMcq ? shuffle : undefined,
            instructions: instructions.trim(),
          },
        },
      },
      {
        onSuccess: () => {
          toast.success("Pengaturan tersimpan");
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Pengaturan — {instrument.name}</DialogPanelTitle>
          <DialogPanelDescription>
            {INSTRUMENT_KIND_LABELS[instrument.kind]} · perubahan berlaku untuk undangan tes baru.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Nama Instrumen</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Durasi (menit)</Label>
              <Input
                type="number"
                min={1}
                max={MAX_DURATION_MINUTES}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
            {isMcq && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Soal Ditarik per Tes</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(e.target.value)}
                  placeholder="Kosong = semua soal aktif"
                />
              </div>
            )}
          </div>

          {isMcq && (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-xs font-medium">Acak Urutan Soal</div>
                <p className="text-xs text-muted-foreground">
                  Setiap kandidat mendapat urutan soal berbeda.
                </p>
              </div>
              <Switch checked={shuffle} onCheckedChange={setShuffle} aria-label="Acak urutan soal" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Instruksi untuk Kandidat</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Instruksi yang tampil sebelum kandidat memulai tes ini"
            />
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" onClick={handleSave} disabled={updateInstrument.isPending}>
            {updateInstrument.isPending && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
