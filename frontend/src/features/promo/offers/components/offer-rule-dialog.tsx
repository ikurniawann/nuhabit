"use client";

import { useMemo, useReducer } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { formatRupiah } from "@/lib/format";
import { usePromoCatalog } from "../../catalog";
import {
  OFFER_PAGE_META,
  buildOfferPayload,
  emptyOfferForm,
  offerFormFromRule,
  offerFormReducer,
  type OfferForm,
} from "../offer-form";
import { useCreateOfferRule, useUpdateOfferRule } from "../queries";
import type { OfferRule, OfferType } from "../types";
import { OfferLimitsFields } from "./offer-limits-fields";
import { OfferTypeFields } from "./offer-type-fields";

/**
 * Dialog buat/ubah penawaran. Dipasang dengan `key` per aturan supaya state
 * form diinisialisasi ulang dari props tanpa effect.
 */
export function OfferRuleDialog({ offerType, rule, onClose }: {
  offerType: OfferType;
  /** null = aturan baru. */
  rule: OfferRule | null;
  onClose: () => void;
}) {
  const meta = OFFER_PAGE_META[offerType];
  const [form, dispatch] = useReducer(offerFormReducer, rule, (r) => (r ? offerFormFromRule(r) : emptyOfferForm(offerType)));
  const createMutation = useCreateOfferRule(offerType);
  const updateMutation = useUpdateOfferRule(offerType);
  const saving = createMutation.isPending || updateMutation.isPending;

  const catalog = usePromoCatalog();
  const categoryOptions = useMemo(
    () => (catalog.data?.categories ?? []).map((c) => ({ id: c.id, label: c.name })),
    [catalog.data]
  );
  const productOptions = useMemo(
    () =>
      (catalog.data?.products ?? []).map((p) => {
        const price = Number(p.price);
        return { id: p.id, label: `${p.name}${price ? ` · ${formatRupiah(price)}` : ""}` };
      }),
    [catalog.data]
  );

  async function handleSave() {
    const payload = buildOfferPayload(offerType, form);
    try {
      if (rule) {
        await updateMutation.mutateAsync({ id: rule.id, payload });
        toast.success("Aturan diperbarui");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Aturan dibuat");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  const patch = (value: Partial<OfferForm>) => dispatch({ type: "patch", patch: value });

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {rule ? "Edit" : "Tambah"} {meta.title}
          </DialogPanelTitle>
          <DialogPanelDescription>{meta.note}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2">
              <Label>Nama</Label>
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} className="border-gray-200/80" />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <Label>Deskripsi</Label>
              <Input
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                className="border-gray-200/80"
              />
            </label>
            <label className="space-y-1.5">
              <Label>Berlaku dari</Label>
              <Input
                type="date"
                value={form.valid_from}
                onChange={(e) => patch({ valid_from: e.target.value })}
                className="border-gray-200/80"
              />
            </label>
            <label className="space-y-1.5">
              <Label>Berlaku sampai</Label>
              <Input
                type="date"
                value={form.valid_until}
                onChange={(e) => patch({ valid_until: e.target.value })}
                className="border-gray-200/80"
              />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-gray-200/70 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Aktif</div>
              <div className="text-xs text-muted-foreground">Nonaktif = tidak dipakai di kasir POS</div>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(checked) => patch({ is_active: checked })} />
          </div>

          <OfferTypeFields
            offerType={offerType}
            form={form}
            dispatch={dispatch}
            productOptions={productOptions}
            categoryOptions={categoryOptions}
            productsLoading={catalog.isLoading}
          />
          <OfferLimitsFields
            value={form.limits}
            onChange={(limitsPatch) => dispatch({ type: "patchLimits", patch: limitsPatch })}
          />
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="bg-primary hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              "Simpan"
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
