"use client";

import { useReducer } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatNumber } from "@/lib/format";
import {
  COMPLETE_HEADER_FIELDS,
  buildCompletePayload,
  canSubmitComplete,
  completeFormReducer,
  completePreview,
  initCompleteForm,
  isVariantBalanced,
  variantRemainder,
} from "@/lib/purchasing/production-ui-complete";
import type { ProductionDetail } from "../types";
import { CompleteHppPreview } from "./complete-hpp-preview";
import { CompleteProductionMaterials } from "./complete-production-materials";

const INPUT_CLASS = "h-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

type CompleteProductionDialogProps = {
  order: ProductionDetail;
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildCompletePayload>) => void;
};

/** Form "Terima Output": state di-reset setiap dibuka karena panel di-mount ulang. */
export function CompleteProductionDialog({ open, submitting, onClose, ...props }: CompleteProductionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      {open && <CompleteProductionPanel submitting={submitting} onClose={onClose} {...props} />}
    </Dialog>
  );
}

function CompleteProductionPanel({
  order,
  submitting,
  onClose,
  onSubmit,
}: Omit<CompleteProductionDialogProps, "open">) {
  const [form, dispatch] = useReducer(completeFormReducer, order, initCompleteForm);
  const preview = completePreview(form);
  const variantRequired = !!order.variant_required;
  const remainder = variantRemainder(form);

  return (
    <DialogPanel size="xl" className="max-h-[min(92vh,960px)]">
      <DialogPanelHeader>
        <DialogPanelTitle>Terima Output Produksi</DialogPanelTitle>
        <DialogPanelDescription>
          Finalisasi kuantitas output, konsumsi bahan aktual, dan HPP untuk {order.nomor_produksi}.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-5">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-sm">Output & Biaya Tambahan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 md:grid-cols-5">
            {COMPLETE_HEADER_FIELDS.map(({ field, label }) => (
              <div key={field} className="space-y-1.5">
                <Label className="text-xs text-gray-500">{label}</Label>
                <Input
                  value={form[field]}
                  onChange={(event) => dispatch({ type: "setField", field, value: event.target.value })}
                  type="number"
                  min="0"
                  className={INPUT_CLASS}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {variantRequired && (
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
              <div>
                <CardTitle className="text-sm">Rincian per Varian</CardTitle>
                <p className="mt-1 text-xs text-gray-500">
                  Produk ini ber-varian — bagi output aktual ke tiap SKU sebelum diterima.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => dispatch({ type: "splitEvenly" })}
                className="h-8 gap-1.5 rounded-lg px-3 text-xs"
              >
                Bagi Rata
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 text-left font-semibold">SKU</th>
                      <th className="py-2 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.variantOutput.map((row) => (
                      <tr key={row.posSkuId}>
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-900">{row.sku}</p>
                          <p className="text-xs text-gray-500">{row.name}</p>
                        </td>
                        <td className="py-2">
                          <Input
                            value={row.qty}
                            onChange={(event) =>
                              dispatch({ type: "setVariantQty", posSkuId: row.posSkuId, value: event.target.value })
                            }
                            type="number"
                            min="0"
                            className={`${INPUT_CLASS} w-28 text-right`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${
                  isVariantBalanced(remainder) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                <span>Sisa</span>
                <span>{formatNumber(remainder, 3)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
          <CompleteProductionMaterials materials={form.materials} dispatch={dispatch} />
          <CompleteHppPreview preview={preview} outputUnit={order.output_satuan_nama} />
        </div>
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
          onClick={() => onSubmit(buildCompletePayload(form, variantRequired))}
          disabled={submitting || !canSubmitComplete(form, variantRequired)}
          className="purchasing-main-button w-full gap-2 sm:w-auto"
        >
          {submitting ? (
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
  );
}
