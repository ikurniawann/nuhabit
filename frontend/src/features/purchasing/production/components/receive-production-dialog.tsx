"use client";

import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import type { ProductionOrder } from "../types";

type ReceiveProductionDialogProps = {
  order: ProductionOrder | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Konfirmasi terima output cepat dari daftar order (qty rencana, tanpa ubah konsumsi). */
export function ReceiveProductionDialog({ order, loading, onClose, onConfirm }: ReceiveProductionDialogProps) {
  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Terima Output Produksi</DialogPanelTitle>
          <DialogPanelDescription>
            Posting kuantitas rencana dan pemakaian bahan ke inventori untuk{" "}
            <span className="font-medium text-gray-900">{order?.nomor_produksi}</span>. Sesuaikan kuantitas di
            halaman detail order jika pemakaian aktual berbeda.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="purchasing-secondary-button"
          >
            Batal
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading} className="purchasing-main-button gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menerima...
              </>
            ) : (
              <>
                <PackageCheck className="h-4 w-4" />
                Terima Output
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
