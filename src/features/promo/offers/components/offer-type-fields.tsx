"use client";

// Bagian form khusus tiap tipe penawaran: bundling, BXGY, diskon volume.

import type { Dispatch } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatIdrInput, parseIdrDigits } from "@/components/pos/idr-input";
import type { OfferForm, OfferFormAction } from "../offer-form";
import type { BxgyGetMode, OfferDiscountType, OfferItemRole, OfferType, VolumeBasis } from "../types";
import { OfferItemEditor, type PickerOption } from "./offer-item-editor";

type NumericKey = "bundle_price" | "buy_qty" | "get_qty" | "volume_min" | "discount_value";

function NumberField({ label, placeholder, field, form, dispatch }: {
  label: string;
  placeholder: string;
  field: NumericKey;
  form: OfferForm;
  dispatch: Dispatch<OfferFormAction>;
}) {
  return (
    <label className="block space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={formatIdrInput(form[field])}
        onChange={(e) => dispatch({ type: "patch", patch: { [field]: String(parseIdrDigits(e.target.value) || "") } })}
        className="border-gray-200/80 tabular-nums"
      />
    </label>
  );
}

export function OfferTypeFields({ offerType, form, dispatch, productOptions, categoryOptions, productsLoading }: {
  offerType: OfferType;
  form: OfferForm;
  dispatch: Dispatch<OfferFormAction>;
  productOptions: PickerOption[];
  categoryOptions: PickerOption[];
  productsLoading: boolean;
}) {
  const patch = (value: Partial<OfferForm>) => dispatch({ type: "patch", patch: value });
  const editor = (title: string, role: OfferItemRole, options: { categories: boolean; showQty?: boolean }) => (
    <OfferItemEditor
      title={title}
      items={form.items.filter((i) => i.role === role)}
      productOptions={productOptions}
      categoryOptions={options.categories ? categoryOptions : []}
      productsLoading={productsLoading}
      showQty={options.showQty}
      onAdd={() => dispatch({ type: "addItem", role, key: `${role}-${Date.now()}-${Math.random()}` })}
      onPatch={(key, itemPatch) => dispatch({ type: "patchItem", key, patch: itemPatch })}
      onRemove={(key) => dispatch({ type: "removeItem", key })}
    />
  );

  if (offerType === "bundle") {
    return (
      <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
        <NumberField label="Harga bundling (Rp)" placeholder="0" field="bundle_price" form={form} dispatch={dispatch} />
        {editor("Komponen produk", "component", { categories: false, showQty: true })}
      </div>
    );
  }

  if (offerType === "bxgy") {
    return (
      <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Qty beli (X)" placeholder="1" field="buy_qty" form={form} dispatch={dispatch} />
          <NumberField label="Qty gratis (Y)" placeholder="1" field="get_qty" form={form} dispatch={dispatch} />
          <label className="space-y-1.5">
            <Label>Gratis berupa</Label>
            <Select value={form.get_mode} onValueChange={(value) => patch({ get_mode: value as BxgyGetMode })}>
              <SelectTrigger className="border-gray-200/80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same_as_buy">Item yang sama</SelectItem>
                <SelectItem value="specific_products">Produk spesifik</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {editor("Produk yang dibeli", "buy", { categories: true })}
        {form.get_mode === "specific_products" && editor("Produk gratis", "get", { categories: true })}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <Label>Basis minimum</Label>
          <Select value={form.volume_basis} onValueChange={(value) => patch({ volume_basis: value as VolumeBasis })}>
            <SelectTrigger className="border-gray-200/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="qty">Minimum qty (beli N)</SelectItem>
              <SelectItem value="spend">Minimum belanja (Rp)</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label={form.volume_basis === "spend" ? "Minimum belanja (Rp)" : "Minimum qty"}
          placeholder="0"
          field="volume_min"
          form={form}
          dispatch={dispatch}
        />
        <label className="space-y-1.5">
          <Label>Tipe diskon</Label>
          <Select value={form.discount_type} onValueChange={(value) => patch({ discount_type: value as OfferDiscountType })}>
            <SelectTrigger className="border-gray-200/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Persen (%)</SelectItem>
              <SelectItem value="fixed">Nominal (Rp)</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label={form.discount_type === "percent" ? "Nilai diskon (%)" : "Nilai diskon (Rp)"}
          placeholder="0"
          field="discount_value"
          form={form}
          dispatch={dispatch}
        />
      </div>
      {editor("Produk eligible (opsional)", "eligible", { categories: true })}
    </div>
  );
}
