"use client";

import { useState } from "react";
import { Loader2, PackageMinus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, formatRupiah } from "@/lib/format";
import { recipeUnitNote } from "@/lib/purchasing/production-ui-display";
import {
  buildIssuePayload,
  initIssueRows,
  issueShortages,
  type ProductionFlow,
} from "@/lib/purchasing/production-flow";
import { ScrollRegion } from "@/components/ui/scroll-region";

const INPUT_CLASS = "h-9 w-28 text-right text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

type IssueMaterialsDialogProps = {
  flow: ProductionFlow;
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildIssuePayload>) => void;
};

/** Form "Keluarkan Bahan": state di-reset setiap dibuka karena panel di-mount ulang. */
export function IssueMaterialsDialog({ open, submitting, onClose, ...props }: IssueMaterialsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      {open && <IssueMaterialsPanel submitting={submitting} onClose={onClose} {...props} />}
    </Dialog>
  );
}

function IssueMaterialsPanel({ flow, submitting, onClose, onSubmit }: Omit<IssueMaterialsDialogProps, "open">) {
  const [rows, setRows] = useState(() => initIssueRows(flow.materials));
  const [catatan, setCatatan] = useState("");
  const short = new Set(issueShortages(rows, flow.materials));
  const payload = buildIssuePayload(rows, catatan);
  const value = flow.materials.reduce((sum, m, i) => sum + Number(rows[i]?.qty || 0) * m.unit_cost, 0);

  const setQty = (materialId: string, qty: string) =>
    setRows((current) => current.map((row) => (row.materialId === materialId ? { ...row, qty } : row)));

  return (
    <DialogPanel size="xl" className="max-h-[min(92vh,960px)]">
      <DialogPanelHeader>
        <DialogPanelTitle>Keluarkan Bahan</DialogPanelTitle>
        <DialogPanelDescription>
          Bahan yang dikeluarkan keluar dari stok dan masuk ke WIP {flow.order.nomor_produksi}. Bisa dikeluarkan
          bertahap.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-4">
        <ScrollRegion label="Tabel bahan yang dikeluarkan" className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 text-left font-semibold">Bahan</th>
                <th className="py-2 text-right font-semibold">Rencana</th>
                <th className="py-2 text-right font-semibold">Sudah Keluar</th>
                <th className="py-2 text-right font-semibold">Stok</th>
                <th className="py-2 text-right font-semibold">Keluarkan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flow.materials.map((m, i) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-gray-900">{m.nama}</p>
                    <p className="text-xs text-gray-500">{m.kode}</p>
                  </td>
                  <td className="py-2 text-right text-gray-700">
                    <p>
                      {formatNumber(m.qty_planned, 4)} {m.satuan}
                    </p>
                    {recipeUnitNote(m.recipe_qty, m.recipe_satuan, m.satuan) && (
                      <p className="text-xs text-gray-500">{recipeUnitNote(m.recipe_qty, m.recipe_satuan, m.satuan)}</p>
                    )}
                  </td>
                  <td className="py-2 text-right text-gray-700">{formatNumber(m.qty_issued, 4)}</td>
                  <td className="py-2 text-right text-gray-700">{formatNumber(m.qty_onhand, 4)}</td>
                  <td className="py-2">
                    <div className="flex flex-col items-end gap-1">
                      <Input
                        aria-label={`Jumlah ${m.nama} yang dikeluarkan (${m.satuan || "satuan stok"})`}
                        value={rows[i]?.qty ?? ""}
                        onChange={(event) => setQty(m.id, event.target.value)}
                        type="number"
                        min="0"
                        step="any"
                        className={INPUT_CLASS}
                      />
                      {short.has(m.id) && <span className="text-xs font-medium text-red-600">Melebihi stok</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="space-y-1.5">
          <Label htmlFor="issue-note" className="text-xs text-gray-500">
            Catatan
          </Label>
          <Textarea id="issue-note" value={catatan} onChange={(event) => setCatatan(event.target.value)} rows={2} />
        </div>
        <p className="rounded-lg bg-pink-50 px-3 py-2 text-sm text-pink-800">
          Perkiraan nilai ke WIP <span className="font-semibold">{formatRupiah(value)}</span> (biaya rata-rata saat
          bahan keluar bisa berbeda).
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
          disabled={submitting || payload.lines.length === 0 || short.size > 0}
          className="purchasing-main-button w-full gap-2 sm:w-auto"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
          Keluarkan Bahan
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
