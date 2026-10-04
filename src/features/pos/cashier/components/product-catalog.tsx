"use client";

import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MemberPriceText } from "@/components/pos/MemberPriceText";
import { PosOfferBanners } from "@/components/pos/PosOfferBanners";
import { PosProductThumbnail } from "@/components/pos/PosProductThumbnail";
import type { CustomerWithDiscount, Product } from "@/lib/pos-api";
import { cashierProductGridClass, cashierProductScrollClass } from "../cashier-workspace-layout";
import { displayXp, productXpLock, productXpLockMessage } from "../catalog";
import type { PosActiveOffer } from "../offers";

const CHIP = "rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all";
const chipState = (active: boolean) =>
  active ? "bg-primary text-primary-foreground" : "bg-gray-100 text-gray-700 hover:bg-gray-200";

/** Filter stall (kasir pusat mode semua stall), kategori, banner promo. */
export function CatalogFilters(props: {
  stallOptions: Array<{ id: string; label: string }> | null;
  stall: string;
  categories: string[];
  category: string;
  offers: PosActiveOffer[];
  onStall: (id: string) => void;
  onCategory: (category: string) => void;
  onApplyOffer: (offer: PosActiveOffer) => void;
}) {
  return (
    <>
      {props.stallOptions && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {props.stallOptions.map((stall) => (
            <button
              key={stall.id}
              type="button"
              onClick={() => props.onStall(stall.id)}
              className={`border border-gray-200/70 ${CHIP} ${chipState(props.stall === stall.id)}`}
            >
              {stall.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {props.categories.map((cat) => (
          <button key={cat} onClick={() => props.onCategory(cat)} className={`${CHIP} ${chipState(props.category === cat)}`}>
            {cat}
          </button>
        ))}
      </div>

      {props.offers.length > 0 && (
        <PosOfferBanners offers={props.offers} className="pb-1" onApplyOffer={props.onApplyOffer} />
      )}
    </>
  );
}

export function ProductGrid(props: {
  products: Product[];
  customer: CustomerWithDiscount | null;
  isTabletMode: boolean;
  showStallName: boolean;
  arkEnabled: boolean;
  xpEnabled: boolean;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  onPick: (product: Product) => void;
}) {
  const { customer, isTabletMode, arkEnabled, xpEnabled } = props;
  const membershipPct = customer ? customer.discount : 0;
  const smallText = isTabletMode ? "text-[11px]" : "text-[9px]";
  return (
    <div className={cashierProductScrollClass()}>
      <div className={cashierProductGridClass()}>
        {props.products.map((product) => {
          // Produk privilege member (EPIC-011 Fase C): terkunci sampai XP cukup.
          const lock = productXpLock(product, customer, xpEnabled);
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => {
                if (lock.locked) {
                  toast.error(productXpLockMessage(lock, Boolean(customer)));
                  return;
                }
                props.onPick(product);
              }}
              className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all ${
                lock.locked
                  ? "border-gray-200/70 bg-white opacity-60"
                  : "border-gray-200/70 bg-white hover:border-primary/50 hover:shadow-sm"
              }`}
            >
              {xpEnabled && lock.minXp > 0 && (
                <span
                  className={`absolute right-1 top-1 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    lock.locked ? "bg-gray-800/80 text-white" : "bg-purple-600 text-white"
                  }`}
                >
                  {lock.locked ? "🔒 " : "★ "}
                  {lock.minXp} XP
                </span>
              )}
              <div className={`${isTabletMode ? "aspect-[16/10]" : "aspect-[5/4]"} w-full overflow-hidden bg-gray-100`}>
                <PosProductThumbnail src={product.image_url} alt={product.name} />
              </div>
              <div className={`flex flex-col ${isTabletMode ? "gap-0.5 p-2 @min-[40rem]:gap-1 @min-[40rem]:p-2.5" : "gap-0.5 p-1.5"}`}>
                <div
                  className={`line-clamp-2 font-medium leading-snug text-gray-900 ${
                    isTabletMode ? "text-[11px] @min-[40rem]:text-xs" : "text-[11px] leading-tight"
                  }`}
                >
                  {product.name}
                </div>
                {props.showStallName && product.stall_name ? (
                  <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                    {product.stall_name}
                  </div>
                ) : null}
                <div className={`font-bold text-brand-text ${isTabletMode ? "text-xs @min-[40rem]:text-sm" : "text-[11px]"}`}>
                  {/* Member terpilih: harga reguler dicoret + harga member (owner 2026-10-01). */}
                  <MemberPriceText
                    price={product.base_price}
                    memberDiscountPercent={membershipPct}
                    format={props.formatCurrency}
                    strikeClassName="text-gray-500"
                  />
                </div>
                {(arkEnabled || xpEnabled) && (
                  <div className="flex items-center justify-between gap-1">
                    {arkEnabled ? (
                      <span className={`font-medium text-amber-600 ${smallText}`}>{props.formatArk(product.base_price)}</span>
                    ) : (
                      <span />
                    )}
                    {xpEnabled && (
                      <span className={`inline-flex items-center gap-0.5 font-semibold text-purple-600 ${smallText}`}>
                        <Sparkles className={isTabletMode ? "h-3 w-3" : "h-2.5 w-2.5"} />+{displayXp(product)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
