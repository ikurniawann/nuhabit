"use client";

import { Sparkles, X } from "lucide-react";
import { HelpHint } from "@/components/ui/help-hint";
import { MemberPriceText } from "@/components/pos/MemberPriceText";
import { PosProductThumbnail } from "@/components/pos/PosProductThumbnail";
import type { CustomerWithDiscount, Product } from "@/lib/pos-api";

/** Member terpilih (tier, diskon, saldo ARK) dan produk favoritnya. */
export function CustomerStrip(props: {
  customer: CustomerWithDiscount | null;
  favorites: Product[];
  isTabletMode: boolean;
  arkEnabled: boolean;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  onClear: () => void;
  onPickFavorite: (product: Product) => void;
}) {
  const { customer, favorites, arkEnabled } = props;
  const discount = customer ? customer.discount : 0;
  return (
    <>
      {customer && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 to-amber-50 p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-brand-text">
            {customer.name?.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{customer.name}</div>
            <div className="text-xs text-gray-600 flex items-center gap-2">
              <span className="capitalize">{customer.membership_tier}</span>
              <span className="text-gray-300">•</span>
              <span className="font-medium text-green-600">{customer.discount}% off</span>
              <HelpHint helpId="pos.discount" role="default" />
              {arkEnabled && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-amber-600 font-medium">{props.formatArk(customer.ark_coin_balance)}</span>
                </>
              )}
            </div>
          </div>
          <button onClick={props.onClear} className="p-1 text-gray-400 hover:text-red-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {favorites.length > 0 && (
        <div className="rounded-xl border border-amber-100/80 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-700">
              {customer?.name?.split(" ")[0]}&apos;s favorites
            </span>
            <span className="text-xs text-amber-600">({favorites.length} items)</span>
          </div>
          <div
            className={
              props.isTabletMode
                ? "grid grid-cols-2 gap-2 @min-[22rem]:grid-cols-3 @min-[36rem]:grid-cols-4"
                : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            }
          >
            {favorites.map((product) => (
              <button
                key={product.id}
                onClick={() => props.onPickFavorite(product)}
                className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-white p-2 text-left transition-all hover:border-amber-400 hover:bg-amber-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                  <PosProductThumbnail src={product.image_url} alt={product.name} iconClassName="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">{product.name}</div>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <MemberPriceText
                      price={product.base_price}
                      memberDiscountPercent={discount}
                      format={props.formatCurrency}
                      className="text-xs text-brand-text font-semibold"
                      strikeClassName="text-gray-500"
                    />
                    {arkEnabled && (
                      <span className="text-[10px] text-amber-600 font-medium">
                        {props.formatArk(product.base_price)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
