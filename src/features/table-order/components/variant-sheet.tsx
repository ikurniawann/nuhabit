"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import {
  formatRupiah,
  resolveModifiers,
  resolveVariant,
  unitPriceFor,
  type SelectedModifier,
  type TableOrderModifierGroup,
  type TableOrderProduct,
  type TableOrderVariant,
} from "@/lib/table-order/menu";
import { MAX_LINE_QTY, memberPrice } from "@/lib/table-order/pricing";
import { BottomSheet } from "./sheet";

type AddHandler = (
  product: TableOrderProduct,
  variant: TableOrderVariant | null,
  quantity: number,
  modifiers: SelectedModifier[]
) => void;

export function VariantSheet({
  product,
  memberDiscountPercent = 0,
  onClose,
  onAdd,
}: {
  product: TableOrderProduct | null;
  /** Diskon tier member login — total dicoret + harga member. */
  memberDiscountPercent?: number;
  onClose: () => void;
  onAdd: AddHandler;
}) {
  if (!product) return null;
  // key=product.id → state pilihan/qty otomatis mulai dari awal utk produk lain.
  return (
    <VariantSheetBody
      key={product.id}
      product={product}
      memberDiscountPercent={memberDiscountPercent}
      onClose={onClose}
      onAdd={onAdd}
    />
  );
}

/** Awal: grup wajib (min ≥ 1) terisi opsi pertama; add-on opsional kosong. */
function initialModifierIds(groups: TableOrderModifierGroup[]) {
  return groups.flatMap((group) =>
    group.minSelection >= 1 ? group.modifiers.slice(0, group.minSelection).map((m) => m.id) : []
  );
}

function VariantSheetBody({
  product,
  memberDiscountPercent,
  onClose,
  onAdd,
}: {
  product: TableOrderProduct;
  memberDiscountPercent: number;
  onClose: () => void;
  onAdd: AddHandler;
}) {
  const [variantId, setVariantId] = useState<string | null>(product.variants[0]?.id ?? null);
  const [modifierIds, setModifierIds] = useState<string[]>(() => initialModifierIds(product.modifierGroups));
  const [quantity, setQuantity] = useState(1);
  const variant = resolveVariant(product, variantId);
  const modifiers = resolveModifiers(product, modifierIds);
  const selected = modifiers.ok ? modifiers.selected : [];
  const unitPrice = unitPriceFor(product, variant, selected);

  function toggleModifier(group: TableOrderModifierGroup, id: string) {
    setModifierIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      const inGroup = group.modifiers.map((m) => m.id);
      const picked = current.filter((value) => inGroup.includes(value));
      // Batas 1 → ganti pilihan (seperti radio); batas > 1 → tambah selama belum penuh.
      if (group.maxSelection <= 1) return [...current.filter((value) => !inGroup.includes(value)), id];
      return picked.length < group.maxSelection ? [...current, id] : current;
    });
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <div className="space-y-2">
          {!modifiers.ok && <p className="text-center text-xs font-semibold text-red-600">{modifiers.error}</p>}
          <div className="flex items-center gap-3">
            <div className="inline-flex h-11 items-center rounded-full border border-gray-200">
              <button
                type="button"
                onClick={() => setQuantity((qty) => Math.max(1, qty - 1))}
                className="flex size-10 items-center justify-center text-gray-700"
                aria-label="Kurangi jumlah"
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-8 text-center text-sm font-bold">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((qty) => Math.min(MAX_LINE_QTY, qty + 1))}
                className="flex size-10 items-center justify-center text-gray-700"
                aria-label="Tambah jumlah"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <button
              type="button"
              disabled={!modifiers.ok}
              onClick={() => modifiers.ok && onAdd(product, variant, quantity, modifiers.selected)}
              className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap rounded-xl bg-primary px-4 text-sm font-bold tabular-nums text-white shadow-sm transition active:scale-[0.99] disabled:bg-gray-300"
            >
              {/* Label singkat (revisi owner 2026-10-01): harga ratusan ribu +
                  harga coret member tidak muat bersama "Tambah ke keranjang". */}
              <span>Tambah</span>
              {memberPrice(unitPrice, memberDiscountPercent) < unitPrice ? (
                <span className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium text-white/70 line-through">
                    {formatRupiah(unitPrice * quantity)}
                  </span>
                  <span>{formatRupiah(memberPrice(unitPrice, memberDiscountPercent) * quantity)}</span>
                </span>
              ) : (
                <span>{formatRupiah(unitPrice * quantity)}</span>
              )}
            </button>
          </div>
        </div>
      }
    >
      {product.image && (
        <img src={product.image} alt={product.name} className="h-44 w-full rounded-2xl object-cover" />
      )}
      {product.description && (
        <p className="mt-3 text-sm leading-relaxed text-gray-600">{product.description}</p>
      )}

      {product.variants.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-900">Pilih varian</div>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              Wajib pilih 1
            </span>
          </div>
          <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {product.variants.map((option) => {
              const isSelected = option.id === variant?.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setVariantId(option.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`flex size-5 items-center justify-center rounded-full border-2 ${
                        isSelected ? "border-primary bg-primary text-white" : "border-gray-300"
                      }`}
                    >
                      {isSelected && <Check className="size-3" />}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{option.name}</span>
                  </span>
                  <span className="text-sm text-gray-600">
                    {option.priceAdjustment > 0 ? `+${formatRupiah(option.priceAdjustment)}` : "Gratis"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {product.modifierGroups.map((group) => {
        const required = group.minSelection >= 1;
        return (
          <div key={group.id} className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-gray-900">{group.name}</div>
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                {required
                  ? `Wajib pilih ${group.minSelection}`
                  : group.maxSelection > 1
                    ? `Opsional, maks. ${group.maxSelection}`
                    : "Opsional"}
              </span>
            </div>
            <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {group.modifiers.map((option) => {
                const isSelected = modifierIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleModifier(group, option.id)}
                    aria-pressed={isSelected}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={`flex size-5 items-center justify-center rounded-md border-2 ${
                          isSelected ? "border-primary bg-primary text-white" : "border-gray-300"
                        }`}
                      >
                        {isSelected && <Check className="size-3" />}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{option.name}</span>
                    </span>
                    <span className="text-sm text-gray-600">
                      {option.priceAdjustment > 0 ? `+${formatRupiah(option.priceAdjustment)}` : "Gratis"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </BottomSheet>
  );
}
