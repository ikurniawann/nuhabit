"use client";

import { useState } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import {
  buildReturnPayload,
  returnErrors,
  returnValue,
  type ProductionFlow,
  type ReturnRows,
} from "@/lib/purchasing/production-flow";
import { ReturnLinesTable } from "./return-lines-table";

type ReturnMaterialsDialogProps = {
  flow: ProductionFlow;
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildReturnPayload>) => void;
};

/** Form "Kembalikan Bahan": state di-reset setiap dibuka karena panel di-mount ulang. */
export function ReturnMaterialsDialog({ open, submitting, onClose, ...props }: ReturnMaterialsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      {open && <ReturnMaterialsPanel submitting={submitting} onClose={onClose} {...props} />}
    </Dialog>
  );
}

function ReturnMaterialsPanel({ flow, submitting, onClose, onSubmit }: Omit<ReturnMaterialsDialogProps, "open">) {
  const [rows, setRows] = useState<ReturnRows>({});
  const [catatan, setCatatan] = useState("");
  const payload = buildReturnPayload(rows, catatan);
  const invalid = returnErrors(rows, flow.materials).length > 0;

  return (
    <DialogPanel size="xl" className="max-h-[min(92vh,960px)]">
      <DialogPanelHeader>
        <DialogPanelTitle>Kembalikan Bahan</DialogPanelTitle>
        <DialogPanelDescription>
          Bahan yang tidak terpakai kembali ke stok gudang asalnya dan keluar dari WIP {flow.order.nomor_produksi},
          senilai harga rata-rata saat bahan dikeluarkan.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-4">
        <ReturnLinesTable materials={flow.materials} rows={rows} onChange={setRows} />
        <div className="space-y-1.5">
          <Label htmlFor="return-note" className="text-xs text-gray-500">
            Catatan
          </Label>
          <Textarea id="return-note" value={catatan} onChange={(event) => setCatatan(event.target.value)} rows={2} />
        </div>
        <p className="rounded-lg bg-pink-50 px-3 py-2 text-sm text-pink-800">
          Nilai kembali ke stok <span className="font-semibold">{formatRupiah(returnValue(rows, flow.materials))}</span>
        </p>
      </DialogPanelBody>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
          className="purchasing-secondary-button w-full gap-2 sm:w-auto"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={() => onSubmit(payload)}
          disabled={submitting || payload.lines.length === 0 || invalid}
          className="purchasing-main-button w-full gap-2 sm:w-auto"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
          Kembalikan Bahan
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
