"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatIdrInput, parseIdrDigits } from "@/components/pos/idr-input";
import { draftTarget, type DraftItem } from "../offer-form";

export type PickerOption = { id: string; label: string };

/** Daftar produk/kategori satu peran (komponen, beli, gratis, eligible). */
export function OfferItemEditor({
  title,
  items,
  productOptions,
  categoryOptions,
  productsLoading,
  showQty = false,
  onAdd,
  onPatch,
  onRemove,
}: {
  title: string;
  items: DraftItem[];
  productOptions: PickerOption[];
  /** Kosong = baris hanya boleh produk (komponen bundling). */
  categoryOptions: PickerOption[];
  productsLoading: boolean;
  showQty?: boolean;
  onAdd: () => void;
  onPatch: (key: string, patch: Partial<DraftItem>) => void;
  onRemove: (key: string) => void;
}) {
  const allowCategory = categoryOptions.length > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {allowCategory ? "Produk / kategori" : "Produk"}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada produk.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isCategory = item.kind === "category";
            const options = isCategory ? categoryOptions : productOptions;
            const placeholder = productsLoading ? "Memuat…" : isCategory ? "Pilih kategori" : "Pilih produk";
            return (
              <div key={item.key} className="flex flex-wrap items-center gap-2">
                {allowCategory ? (
                  <Select
                    value={item.kind}
                    onValueChange={(kind) =>
                      onPatch(item.key, { kind: kind as DraftItem["kind"], product_id: "", category_id: "" })
                    }
                  >
                    <SelectTrigger className="w-32 border-gray-200/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="product">Produk</SelectItem>
                      <SelectItem value="category">Kategori</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                <Select
                  value={draftTarget(item) || "__none__"}
                  onValueChange={(value) => {
                    const id = value === "__none__" ? "" : value;
                    onPatch(item.key, isCategory ? { category_id: id } : { product_id: id });
                  }}
                >
                  <SelectTrigger className="min-w-[220px] flex-1 border-gray-200/80">
                    <SelectValue placeholder={placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{placeholder}</SelectItem>
                    {options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showQty ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formatIdrInput(item.qty)}
                      onChange={(e) => onPatch(item.key, { qty: String(parseIdrDigits(e.target.value) || "") })}
                      className="w-20 border-gray-200/80 tabular-nums"
                      aria-label="Qty pcs"
                    />
                    <span className="text-xs text-muted-foreground">pcs</span>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-600"
                  onClick={() => onRemove(item.key)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
