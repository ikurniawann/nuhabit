"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Lock, Minus, Plus, Sparkles } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { TableOrderProduct } from "@/lib/table-order/menu";
import { memberPrice } from "@/lib/table-order/pricing";

/**
 * Baris daftar menu — mengikuti referensi (GoFood): kiri nama tebal, baris
 * rating → di sini chip XP + station, deskripsi abu 2 baris, harga tebal;
 * kanan foto persegi 112px dengan tombol "Tambah" berpinggir menumpang di
 * bawah foto dan keterangan "Bisa custom" bila ada varian.
 */
export function MenuItemRow({
  product,
  quantity,
  locked,
  memberDiscountPercent = 0,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: TableOrderProduct;
  quantity: number;
  /** Produk khusus member yang belum memenuhi syarat XP */
  locked: boolean;
  /** Diskon tier member login — harga reguler dicoret + harga member. */
  memberDiscountPercent?: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = Boolean(product.image) && !imageBroken;
  const discounted = memberPrice(product.price, memberDiscountPercent);
  const hasMemberPrice = discounted < product.price;

  return (
    <article className="flex gap-3 border-b border-gray-100 px-4 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold leading-snug text-gray-900">{product.name}</h3>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-600">
          {product.xp > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
              <Sparkles className="size-3.5 fill-amber-500 text-amber-500" />
              +{product.xp} XP
            </span>
          )}
          {product.xp > 0 && <span className="text-gray-300">·</span>}
          <span>{product.stationLabel}</span>
          {product.prepTimeMinutes > 0 && (
            <>
              <span className="text-gray-300">·</span>
              <span>~{product.prepTimeMinutes} mnt</span>
            </>
          )}
        </div>

        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">{product.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {hasMemberPrice ? (
            <>
              <span className="text-[15px] font-bold text-brand-text">{formatNumber(discounted)}</span>
              <span className="text-xs text-gray-400 line-through">{formatNumber(product.price)}</span>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-text">
                Member −{memberDiscountPercent}%
              </span>
            </>
          ) : (
            <span className="text-[15px] font-bold text-gray-900">{formatNumber(product.price)}</span>
          )}
          {product.minXp > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                locked ? "bg-gray-100 text-gray-500" : "bg-primary/10 text-brand-text"
              }`}
            >
              <Lock className="size-3" />
              Member ≥ {product.minXp} XP
            </span>
          )}
        </div>
      </div>

      <div className="w-28 shrink-0">
        <div className="relative">
          {showImage ? (
            <img
              src={product.image as string}
              alt={product.name}
              loading="lazy"
              onError={() => setImageBroken(true)}
              className="aspect-square w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-3xl font-black text-brand-text/50">
              {product.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="absolute inset-x-0 -bottom-4 flex justify-center">
            {quantity > 0 ? (
              <div className="inline-flex h-9 items-center rounded-full border-2 border-primary bg-white shadow-sm">
                <button
                  type="button"
                  onClick={onDecrement}
                  className="flex size-8 items-center justify-center rounded-full text-brand-text"
                  aria-label={`Kurangi ${product.name}`}
                >
                  <Minus className="size-4" />
                </button>
                <span className="min-w-6 text-center text-sm font-bold text-gray-900">{quantity}</span>
                <button
                  type="button"
                  onClick={onIncrement}
                  className="flex size-8 items-center justify-center rounded-full text-brand-text"
                  aria-label={`Tambah ${product.name}`}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={locked}
                className="h-9 rounded-full border-2 border-primary bg-white px-6 text-sm font-bold text-brand-text shadow-sm transition active:scale-95 disabled:border-gray-200 disabled:text-gray-400"
              >
                {locked ? "Terkunci" : "Tambah"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] text-gray-400">
          {product.customizable ? "Bisa custom" : " "}
        </p>
      </div>
    </article>
  );
}
