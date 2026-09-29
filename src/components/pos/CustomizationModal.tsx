"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Utensils } from "lucide-react";
import { PosProductThumbnail } from "@/components/pos/PosProductThumbnail";
import type { Product } from "@/lib/pos-api";
import { computeCustomizationPrice } from "@/lib/pos/customization-price";

export interface SelectedCustomization {
  product: Product;
  selectedVariant: string | null;
  selectedModifiers: Record<string, string[]>;
  quantity: number;
  notes: string;
}

interface Props {
  open: boolean;
  product: Product | null;
  value: SelectedCustomization | null;
  onChange: (value: SelectedCustomization | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  formatCurrency: (v: number) => string;
  formatArk: (v: number) => string;
  /** Saklar fitur ARK Coin (CRM → Pengaturan). Default tampil. */
  showArk?: boolean;
}

export function CustomizationModal({
  open,
  product,
  value,
  onChange,
  onConfirm,
  onCancel,
  formatCurrency,
  formatArk,
  showArk = true,
}: Props) {
  if (!product) return null;
  const variants = product.variants || [];
  const modifiers = product.modifiers || [];

  const { basePrice, unitPrice } = computeCustomizationPrice(product, value);
  const lineTotal = unitPrice * (value?.quantity || 1);

  const quantity = value?.quantity || 1;
  const priceLabel = (amount: number, zeroText = "") =>
    amount > 0 ? `+${formatCurrency(amount)}` : amount < 0 ? formatCurrency(amount) : zeroText;
  const optionClass = (selected: boolean) =>
    `flex min-h-11 flex-col justify-center rounded-lg border-2 px-2.5 py-1.5 text-left transition-all ${
      selected ? "border-primary bg-primary/10" : "border-gray-200 hover:border-primary/30"
    }`;

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      {/* Ringkas utk tablet (owner 2026-09-29): body scroll sendiri, footer
          (jumlah · total · tombol) selalu terlihat tanpa perlu scroll. */}
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-gray-100 px-5 py-3 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <PosProductThumbnail src={product.image_url} alt={product.name} iconClassName="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg font-bold">{product.name}</DialogTitle>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-bold text-primary">{formatCurrency(basePrice)}</span>
                {showArk && <span className="text-xs font-medium text-amber-600">{formatArk(basePrice)}</span>}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">
          {/* Variants */}
          {variants.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Pilih Varian
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {variants.map((variant) => {
                  const selected = value?.selectedVariant === variant.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => onChange({ ...value!, selectedVariant: variant.id })}
                      className={optionClass(selected)}
                    >
                      <span className="text-sm font-medium leading-tight text-gray-900">{variant.name}</span>
                      <span className="text-[11px] text-gray-600">{priceLabel(variant.price_adjustment, "Harga sama")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {modifiers.map((group) => {
            const groupName = group.modifier_group.name;
            const selectedIds = value?.selectedModifiers?.[groupName] || [];
            return (
              <div key={group.modifier_group.id} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  <Utensils className="h-3.5 w-3.5 text-primary" />
                  {groupName}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {group.modifier_group.modifiers.map((mod) => {
                    const isSelected = selectedIds.includes(mod.id);
                    const priceText = priceLabel(mod.price_adjustment);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => {
                          const next = { ...(value?.selectedModifiers || {}) };
                          const ids = [...(next[groupName] || [])];
                          if (isSelected) {
                            next[groupName] = ids.filter((id) => id !== mod.id);
                          } else {
                            // obey max_selection if > 0
                            const max = group.modifier_group.max_selection || 1;
                            if (max === 1) {
                              next[groupName] = [mod.id];
                            } else if (ids.length < max) {
                              next[groupName] = [...ids, mod.id];
                            }
                          }
                          onChange({ ...value!, selectedModifiers: next });
                        }}
                        className={optionClass(isSelected)}
                      >
                        <span className="text-sm font-medium leading-tight text-gray-900">{mod.name}</span>
                        {priceText && <span className="text-[11px] font-medium text-amber-600">{priceText}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Notes */}
          <input
            type="text"
            value={value?.notes || ""}
            onChange={(e) => onChange({ ...value!, notes: e.target.value })}
            placeholder="Catatan (opsional) — mis. kurang manis, less ice"
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Footer tetap: jumlah · total · tambah */}
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-100 bg-gray-50/80 px-5 py-3">
          <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white p-1">
            <button
              type="button"
              aria-label="Kurangi jumlah"
              onClick={() => onChange({ ...value!, quantity: Math.max(1, quantity - 1) })}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-gray-100"
            >
              −
            </button>
            <span className="w-8 text-center text-base font-semibold tabular-nums">{quantity}</span>
            <button
              type="button"
              aria-label="Tambah jumlah"
              onClick={() => onChange({ ...value!, quantity: quantity + 1 })}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-gray-100"
            >
              +
            </button>
          </div>
          <div className="min-w-0 flex-1 text-right">
            <div className="text-[11px] text-gray-500">Total ({quantity} item)</div>
            <div className="truncate text-xl font-bold tabular-nums text-primary">{formatCurrency(lineTotal)}</div>
            {showArk && <div className="text-[11px] font-medium text-amber-600">{formatArk(lineTotal)}</div>}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            className="h-12 shrink-0 rounded-lg bg-primary px-5 font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Tambah ke Keranjang
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
