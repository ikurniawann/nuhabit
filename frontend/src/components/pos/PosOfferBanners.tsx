"use client";

import { Gift, Package, Percent, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  OFFER_BANNER_STYLE,
  offerBannerBlurb,
  type PosActiveOffer,
} from "@/features/pos/cashier/offers";

const ICONS = {
  bundle: Package,
  bxgy: Gift,
  volume: Percent,
} as const;

type Props = {
  offers: PosActiveOffer[];
  className?: string;
  /** Klik banner → tambah produk promo ke cart */
  onApplyOffer?: (offer: PosActiveOffer) => void;
};

export function PosOfferBanners({ offers, className, onApplyOffer }: Props) {
  if (!offers.length) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Tag className="h-3.5 w-3.5" />
          Promo aktif
        </div>
        {onApplyOffer && (
          <span className="text-[10px] text-muted-foreground">
            Ketuk untuk masuk keranjang
          </span>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {offers.map((offer) => {
          const style = OFFER_BANNER_STYLE[offer.offer_type];
          const Icon = ICONS[offer.offer_type] || Tag;
          const interactive = Boolean(onApplyOffer);
          const Comp = interactive ? "button" : "div";
          return (
            <Comp
              key={offer.id}
              type={interactive ? "button" : undefined}
              onClick={interactive ? () => onApplyOffer?.(offer) : undefined}
              className={cn(
                "min-w-[200px] max-w-[260px] shrink-0 rounded-xl border p-3 text-left transition-all",
                style.card,
                interactive &&
                  "cursor-pointer hover:shadow-sm hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 active:scale-[0.99]"
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    style.badge
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {style.label}
                </span>
              </div>
              <div className="text-sm font-semibold text-foreground">
                {offer.name}
              </div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {offerBannerBlurb(offer)}
              </div>
            </Comp>
          );
        })}
      </div>
    </div>
  );
}
