"use client";

// Kartu paket ala tiket.com: header + expand detail + stepper per varian.

import { useState } from "react";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import {
  WIZARD_MAX_QTY,
  bundleContentsLabel,
  bundleSaving,
  minVariantPrice,
  personsPerUnit,
  variantLabelOf,
  type CatalogProduct,
  type CatalogVariant,
  type QtyMap,
} from "@/lib/ticketing/booking-wizard-cart";

const STEPPER_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900 disabled:cursor-default disabled:opacity-25 disabled:hover:border-gray-300 disabled:hover:text-gray-600";

interface PackageCardProps {
  product: CatalogProduct;
  isSelected: boolean;
  qty: QtyMap;
  totalQty: number;
  onChangeQty: (product: CatalogProduct, variant: CatalogVariant, delta: number) => void;
}

export function PackageCard({ product, isSelected, qty, totalQty, onChangeQty }: PackageCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const productQty = product.variants.reduce((sum, v) => sum + (qty[v.variant_id] ?? 0), 0);

  return (
    <div
      className={`overflow-hidden rounded-3xl border transition-all ${
        isSelected
          ? "border-rose-500 shadow-[0_6px_16px_rgba(244,63,94,0.15)] ring-1 ring-rose-500"
          : "border-gray-200"
      }`}
    >
      <div className="flex gap-3 p-4">
        {product.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="h-20 w-20 shrink-0 rounded-2xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-[15px] font-semibold text-gray-900">{product.name}</h3>
            {isSelected && productQty > 0 && (
              <span className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-rose-500 px-2 text-[11px] font-semibold text-white">
                <Check className="h-3 w-3" /> {productQty}
              </span>
            )}
          </div>
          {product.description && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
              {product.description}
            </p>
          )}
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[11px] text-gray-400">Mulai</span>
            <span className="text-[15px] font-bold text-gray-900">
              {formatRupiah(minVariantPrice(product))}
            </span>
            <span className="text-[11px] text-gray-400">/tiket</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-gray-100 px-4 py-2.5 text-xs font-semibold text-rose-600"
      >
        {detailOpen ? "Sembunyikan detail" : "Lihat detail & pilih jumlah"}
        <ChevronDown className={`h-4 w-4 transition-transform ${detailOpen ? "rotate-180" : ""}`} />
      </button>

      {detailOpen && (
        <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60 px-4">
          {product.variants.map((variant) => {
            const n = qty[variant.variant_id] ?? 0;
            const saving = bundleSaving(variant);
            const label = variantLabelOf(product, variant);
            return (
              <div key={variant.variant_id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {label}
                    {variant.season_kind === "high" && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        High Season
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {saving && (
                      <span className="mr-1.5 text-xs text-gray-400 line-through">
                        {formatRupiah(saving.standalone)}
                      </span>
                    )}
                    <span className="font-semibold text-gray-900">{formatRupiah(variant.price)}</span>
                    {saving && (
                      <span className="ml-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                        Hemat {formatRupiah(saving.saving)}
                      </span>
                    )}
                  </p>
                  {product.product_kind === "bundle" && variant.members ? (
                    <p className="mt-0.5 text-xs leading-snug text-gray-400">
                      Termasuk: {bundleContentsLabel(variant)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    aria-label={`Kurangi ${label}`}
                    onClick={() => onChangeQty(product, variant, -1)}
                    disabled={n === 0}
                    className={STEPPER_CLASS}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-6 text-center text-[15px] font-medium tabular-nums text-gray-900">
                    {n}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tambah ${label}`}
                    onClick={() => onChangeQty(product, variant, 1)}
                    disabled={isSelected && totalQty + personsPerUnit(variant) > WIZARD_MAX_QTY}
                    className={STEPPER_CLASS}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <p className="py-3 text-[11px] text-gray-400">
            Maks {WIZARD_MAX_QTY} tiket / pemesanan · 1 jenis tiket per transaksi.
          </p>
        </div>
      )}
    </div>
  );
}
