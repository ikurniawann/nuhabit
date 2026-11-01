"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DsDateTimePicker } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/format";
import { validateTermForm, type TermFormValues } from "@/lib/purchasing/po-ui-detail";
import { useCreatePaymentTerm } from "../../mutations";

interface POTermDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poId: string;
  /** Nomor termin berikutnya, untuk deskripsi bawaan. */
  nextTermNo: number;
  schedulable: number;
}

/** Jadwalkan termin pembayaran baru; nominal bawaan = sisa tagihan yang belum dijadwalkan. */
export function POTermDialog({ open, onOpenChange, ...formProps }: POTermDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[520px]">
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">Tambah Termin Pembayaran</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
            Bagi tagihan PO ke beberapa jatuh tempo. Total termin tidak boleh melebihi tagihan bersih.
          </DialogDescription>
        </DialogHeader>
        <TermForm {...formProps} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TermForm({
  poId,
  nextTermNo,
  schedulable,
  onClose,
}: Omit<POTermDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [form, setForm] = useState<TermFormValues>({
    description: `Termin ${nextTermNo}`,
    due_date: "",
    amount: schedulable > 0 ? schedulable : undefined,
    notes: "",
  });
  const createTerm = useCreatePaymentTerm();
  const patch = (values: Partial<TermFormValues>) => setForm((prev) => ({ ...prev, ...values }));

  const handleSubmit = async () => {
    const invalid = validateTermForm(form, schedulable);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      await createTerm.mutateAsync({
        poId,
        payload: {
          description: form.description.trim() || `Termin ${nextTermNo}`,
          due_date: form.due_date,
          amount: Number(form.amount),
          notes: form.notes.trim() || null,
        },
      });
      toast.success("Termin pembayaran ditambahkan");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah termin pembayaran");
    }
  };

  return (
    <>
      <div className="grid gap-4 px-5 py-4">
        <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-3">
          <div className="text-xs font-medium text-gray-500">Belum dijadwalkan</div>
          <div className="mt-1 text-lg font-bold text-gray-900">{formatRupiah(schedulable)}</div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po-term-description" className="text-xs">Deskripsi</Label>
          <Input
            id="po-term-description"
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            className="h-9 text-sm"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DsDateTimePicker
            label="Jatuh Tempo"
            value={form.due_date}
            onChange={(value) => patch({ due_date: value })}
            placeholder="Pilih jatuh tempo..."
            dateOnly
            required
          />
          <div className="space-y-1.5">
            <Label htmlFor="po-term-amount" className="text-xs">Nominal</Label>
            <NumericInput
              id="po-term-amount"
              value={form.amount}
              max={schedulable}
              onValueChange={(value) => patch({ amount: value || undefined })}
              decimalScale={0}
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po-term-notes" className="text-xs">Catatan</Label>
          <Input
            id="po-term-notes"
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            placeholder="Opsional"
            className="h-9 text-sm"
          />
        </div>
      </div>
      <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
        <Button variant="outline" onClick={onClose} className="purchasing-secondary-button">
          Batal
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={createTerm.isPending || schedulable <= 0}
          className="purchasing-main-button"
        >
          {createTerm.isPending ? "Menyimpan..." : "Simpan Termin"}
        </Button>
      </DialogFooter>
    </>
  );
}
