"use client";

import { useState } from "react";
import { Search, ShoppingBag, User, Utensils } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MemberPriceText } from "@/components/pos/MemberPriceText";
import type { Product } from "@/lib/pos-api";
import { categoryName, searchSuggestions } from "../catalog";

interface ProductSearchProps {
  isTabletMode: boolean;
  term: string;
  products: Product[];
  membershipPct: number;
  formatCurrency: (value: number) => string;
  onTermChange: (term: string) => void;
  /** Scanner barcode: true bila input persis kode SKU dan sudah ditangani. */
  onScan: (term: string) => boolean;
  onPick: (product: Product) => void;
}

function ProductSearch(props: ProductSearchProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = searchSuggestions(props.products, props.term);

  const pick = (product: Product | undefined) => {
    if (!product) return;
    props.onPick(product);
    props.onTermChange("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className={`relative flex-1 ${props.isTabletMode ? "min-w-32" : "min-w-[220px]"}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        type="text"
        placeholder="Search products..."
        value={props.term}
        onChange={(e) => {
          const scanned = props.onScan(e.target.value);
          props.onTermChange(scanned ? "" : e.target.value);
          setOpen(!scanned);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((current) => Math.min(current + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(suggestions[active] || suggestions[0]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      {open && props.term.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-80 overflow-y-auto rounded-xl border border-gray-200/70 bg-white p-1 shadow-lg">
          {suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-500">No products found</div>
          ) : (
            suggestions.map((product, index) => {
              const hasOptions = Boolean(product.variants?.length || product.modifiers?.length);
              return (
                <button
                  key={product.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(product)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    index === active ? "bg-primary/10" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900">{product.name}</div>
                    <div className="text-xs text-gray-500">
                      {categoryName(product)} ·{" "}
                      <MemberPriceText
                        price={product.base_price}
                        memberDiscountPercent={props.membershipPct}
                        format={props.formatCurrency}
                      />
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                      hasOptions ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                    }`}
                  >
                    {hasOptions ? "Options" : "Add"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const TOOL_BUTTON = "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all";

/** Dine-in / Take Away, cari customer, dan cari produk. */
export function CashierToolbar(
  props: ProductSearchProps & {
    orderType: string;
    customerName: string | null;
    onOrderType: (orderType: "dine_in" | "takeaway") => void;
    onFindCustomer: () => void;
  }
) {
  const { isTabletMode, orderType, customerName } = props;
  return (
    <div className={`rounded-xl border border-gray-200/70 bg-white shadow-xs ${isTabletMode ? "p-2.5" : "p-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => props.onOrderType("dine_in")}
          className={`${TOOL_BUTTON} ${
            orderType === "dine_in"
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-primary/30 bg-primary/10 text-brand-text hover:border-primary/50 hover:bg-primary/15"
          }`}
        >
          <Utensils className="h-4 w-4" /> Dine-in
        </button>
        <button
          type="button"
          onClick={() => props.onOrderType("takeaway")}
          className={`${TOOL_BUTTON} ${
            orderType === "takeaway"
              ? "border-amber-500 bg-amber-500 text-white shadow-sm"
              : "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100"
          }`}
        >
          <ShoppingBag className="h-4 w-4" /> Take Away
        </button>
        <button
          onClick={props.onFindCustomer}
          className={`${TOOL_BUTTON} ${isTabletMode ? "min-w-0" : "min-w-[150px]"} ${
            customerName !== null
              ? "border-violet-500 bg-violet-500 text-white shadow-sm hover:bg-violet-600"
              : "border-violet-200/80 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100"
          }`}
        >
          <User className="h-4 w-4" />
          <span>{customerName ? customerName.split(" ")[0] : "Find Customer"}</span>
        </button>
        <ProductSearch {...props} />
      </div>
    </div>
  );
}
