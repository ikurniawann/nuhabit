"use client";

import { useState } from "react";
import type { CustomerWithDiscount, Product } from "@/lib/pos-api";
import { cashierLeftPanelClass } from "../cashier-workspace-layout";
import {
  ALL_FILTER,
  catalogCategories,
  filterCatalog,
  findSkuByScan,
  stallFilterOptions,
} from "../catalog";
import type { PosActiveOffer } from "../offers";
import type { useCatalogActions } from "../use-catalog-actions";
import { CashierNotices, CatalogStatus } from "./cashier-notices";
import { CashierStallGate } from "./cashier-stall-gate";
import { CashierToolbar } from "./cashier-toolbar";
import { CustomerStrip } from "./customer-strip";
import { CatalogFilters, ProductGrid } from "./product-catalog";

/** Panel kiri kasir: status, toolbar + pencarian, member, filter, dan grid produk. */
export function CashierCatalogPanel(props: {
  isTabletMode: boolean;
  products: Product[];
  loading: boolean;
  error: string | null;
  blockedReason: string | null;
  /** Kasir pusat mode semua stall: tampilkan filter stall. */
  showStallFilters: boolean;
  showStallNames: boolean;
  offers: PosActiveOffer[];
  customer: CustomerWithDiscount | null;
  favorites: Product[];
  arkEnabled: boolean;
  xpEnabled: boolean;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  orderType: string;
  onOrderType: (orderType: "dine_in" | "takeaway") => void;
  onFindCustomer: () => void;
  onClearCustomer: () => void;
  notices: Parameters<typeof CashierNotices>[0];
  actions: Pick<ReturnType<typeof useCatalogActions>, "openProduct" | "selectMerchSku" | "applyOffer">;
}) {
  const { products, customer, actions } = props;
  const [filter, setFilter] = useState({ stall: ALL_FILTER, category: ALL_FILTER, search: "" });

  return (
    <>
      <CatalogStatus loading={props.loading} error={props.error} />
      <div className={`relative ${cashierLeftPanelClass(props.isTabletMode)}`}>
        {props.blockedReason && !props.loading && <CashierStallGate reason={props.blockedReason} />}
        <CashierNotices {...props.notices} />
        <CashierToolbar
          isTabletMode={props.isTabletMode}
          orderType={props.orderType}
          customerName={customer ? (customer.name ?? "") : null}
          onOrderType={props.onOrderType}
          onFindCustomer={props.onFindCustomer}
          term={filter.search}
          products={products}
          membershipPct={customer ? customer.discount : 0}
          formatCurrency={props.formatCurrency}
          onTermChange={(search) => setFilter((prev) => ({ ...prev, search }))}
          onScan={(term) => {
            const hit = findSkuByScan(products, term);
            if (hit) actions.selectMerchSku(hit.product, hit.sku);
            return Boolean(hit);
          }}
          onPick={actions.openProduct}
        />
        <CustomerStrip
          customer={customer}
          favorites={props.favorites}
          isTabletMode={props.isTabletMode}
          arkEnabled={props.arkEnabled}
          formatCurrency={props.formatCurrency}
          formatArk={props.formatArk}
          onClear={props.onClearCustomer}
          onPickFavorite={actions.openProduct}
        />
        <CatalogFilters
          stallOptions={props.showStallFilters ? stallFilterOptions(products) : null}
          stall={filter.stall}
          categories={catalogCategories(products)}
          category={filter.category}
          offers={props.offers}
          onStall={(stall) => setFilter((prev) => ({ ...prev, stall }))}
          onCategory={(category) => setFilter((prev) => ({ ...prev, category }))}
          onApplyOffer={actions.applyOffer}
        />
        <ProductGrid
          products={filterCatalog(products, filter)}
          customer={customer}
          isTabletMode={props.isTabletMode}
          showStallName={props.showStallNames}
          arkEnabled={props.arkEnabled}
          xpEnabled={props.xpEnabled}
          formatCurrency={props.formatCurrency}
          formatArk={props.formatArk}
          onPick={actions.openProduct}
        />
      </div>
    </>
  );
}
