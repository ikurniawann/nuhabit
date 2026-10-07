"use client";

import { formatNumber } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RealizeConflictError } from "../types";

interface RealizeDialogProps {
  /** null = tertutup; terisi = detail kekurangan dari 409 realisasi */
  conflict: (RealizeConflictError & { quotationId: string }) | null;
  onClose: () => void;
  onForce: (quotationId: string) => void;
  isPending: boolean;
}

/**
 * Dialog stok tidak mencukupi (modifikasi owner F3): tampilkan rincian
 * kekurangan, beri pilihan lanjut TANPA memotong BOM — quotation akan
 * ditandai "BOM tidak terpotong".
 */
export function RealizeDialog({
  conflict,
  onClose,
  onForce,
  isPending,
}: RealizeDialogProps) {
  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Stok Tidak Mencukupi
          </DialogTitle>
          <DialogDescription>
            Realisasi tidak bisa memotong bahan baku sepenuhnya. Lanjutkan
            tanpa potong BOM, atau batalkan dan lengkapi stok dulu.
          </DialogDescription>
        </DialogHeader>

        {conflict && conflict.shortages.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-amber-700">
                  <th className="px-3 py-2 text-left font-semibold">Bahan</th>
                  <th className="px-3 py-2 text-right font-semibold">Butuh</th>
                  <th className="px-3 py-2 text-right font-semibold">Tersedia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {conflict.shortages.map((shortage) => (
                  <tr key={shortage.raw_material_id}>
                    <td className="px-3 py-2 text-gray-900">
                      {shortage.nama}
                      {shortage.kode ? (
                        <span className="ml-1 font-mono text-xs text-gray-400">
                          {shortage.kode}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      {formatNumber(shortage.needed, 2)}
                      {shortage.satuan ? ` ${shortage.satuan}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-red-600">
                      {formatNumber(shortage.available, 2)}
                      {shortage.satuan ? ` ${shortage.satuan}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {conflict && conflict.warnings.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-700">
            {conflict.warnings.map((warning) => (
              <li key={warning}>⚠ {warning}</li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Batal
          </Button>
          <Button
            onClick={() => conflict && onForce(conflict.quotationId)}
            disabled={isPending}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {isPending ? "Memproses…" : "Lanjut Tanpa Potong BOM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
