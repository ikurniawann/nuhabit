"use client";

/**
 * Produk → keranjang. Produk biasa langsung masuk; gift card, merchandise
 * ber-SKU, dan produk bervarian/opsi lewat dialog dulu. Semua jalur lewat
 * `tryAdd` yang menegakkan aturan stall (kasir pusat vs single stall).
 */

import { useState } from "react";
import { toast } from "sonner";
import type { usePosCart } from "@/hooks/use-pos-cart";
import type { Product, ProductSku } from "@/lib/pos-api";
import { resolveAddCatalogItem, uniqueStallIds } from "@/lib/pos/central-cashier";
import {
  computeCustomizationPrice,
  defaultCustomizationSelection,
} from "@/lib/pos/customization-price";
import type { SelectedCustomization } from "@/components/pos/CustomizationModal";
import type { GiftCardSaleValues } from "@/components/pos/GiftCardSaleDialog";
import {
  catalogAddKind,
  catalogLine,
  giftCardLine,
  merchSkuLine,
  type CatalogLine,
} from "./catalog";
import { planOfferQuickAdd, type PosActiveOffer } from "./offers";
import type { GiftCardBuyer } from "./cashier-session";

export type CatalogDialog =
  | { kind: "gift_card"; product: Product }
  | { kind: "merch_sku"; product: Product }
  | { kind: "customize"; product: Product; value: SelectedCustomization };

export function useCatalogActions(deps: {
  cart: ReturnType<typeof usePosCart>;
  products: Product[];
  canSellMixed: boolean;
  centralAllMode: boolean;
  /** Tagihan checkout yang dibuka dengan ?pay=1: keranjang terkunci. */
  payingExistingCheckout: boolean;
  requireActiveShift: () => boolean;
  formatCurrency: (value: number) => string;
  onGiftCardBuyer: (buyer: GiftCardBuyer | null) => void;
}) {
  const { cart } = deps;
  const [dialog, setDialog] = useState<CatalogDialog | null>(null);

  const tryAdd = (product: Product, line: CatalogLine) => {
    const check = resolveAddCatalogItem({
      canSellMixed: deps.canSellMixed,
      existingStallIds: uniqueStallIds(cart.items.map((row) => row.warehouse_id)),
      incomingWarehouseId: product.warehouse_id,
      centralAllMode: deps.centralAllMode,
      payingExistingCheckout: deps.payingExistingCheckout,
    });
    if (!check.ok) {
      toast.error(check.message);
      return false;
    }
    cart.addItem({ ...line, warehouse_id: product.warehouse_id, warehouse_name: product.warehouse_name });
    return true;
  };

  const openProduct = (product: Product) => {
    if (!deps.requireActiveShift()) return;
    const kind = catalogAddKind(product);
    if (kind === "gift_card" || kind === "merch_sku") {
      setDialog({ kind, product });
      return;
    }
    if (kind === "customize") {
      setDialog({
        kind,
        product,
        value: { product, ...defaultCustomizationSelection(product), quantity: 1, notes: "" },
      });
      return;
    }
    tryAdd(product, catalogLine(product, { stallName: product.stall_name ?? undefined }));
  };

  /** Promo banner: tambah produk-produk penawaran yang bisa langsung masuk. */
  const applyOffer = (offer: PosActiveOffer) => {
    if (!deps.requireActiveShift()) return;
    const plan = planOfferQuickAdd(offer);
    const spendVolume = offer.offer_type === "volume" && offer.volume_basis === "spend";
    if (plan.length === 0) {
      toast.error(
        spendVolume
          ? "Promo volume belanja: pilih produk eligible lalu tambah sampai min tercapai"
          : "Promo ini belum punya produk yang bisa ditambahkan otomatis"
      );
      return;
    }

    const byId = new Map(deps.products.map((p) => [p.id, p]));
    let added = 0;
    const skipped: string[] = [];
    const missing: string[] = [];
    for (const row of plan) {
      const product = byId.get(row.productId);
      if (!product) {
        missing.push(row.label);
      } else if (catalogAddKind(product) !== "simple") {
        skipped.push(product.name);
      } else if (tryAdd(product, catalogLine(product, { quantity: row.qty }))) {
        added += 1;
      }
    }

    if (added > 0) toast.success(`Promo “${offer.name}” ditambahkan ke keranjang`);
    if (skipped.length > 0) {
      toast.message(
        `Perlu pilih varian/opsi: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`
      );
    }
    if (missing.length > 0) {
      toast.error(`Produk tidak tersedia di stall: ${missing.slice(0, 3).join(", ")}`);
    }
    if (added === 0 && skipped.length === 0 && missing.length === 0) {
      toast.error("Tidak ada produk yang bisa ditambahkan");
    } else if (added > 0 && spendVolume) {
      toast.message("Tambah qty sampai min belanja promo tercapai");
    }
  };

  /** EPIC-034 Fase B: harga baris = nominal pilihan; server memvalidasi ulang. */
  const confirmGiftCard = (values: GiftCardSaleValues) => {
    if (dialog?.kind !== "gift_card") return;
    if (!tryAdd(dialog.product, giftCardLine(dialog.product, values, deps.formatCurrency))) return;
    deps.onGiftCardBuyer(
      values.buyerName || values.buyerPhone
        ? { name: values.buyerName, phone: values.buyerPhone }
        : null
    );
    setDialog(null);
  };

  const selectMerchSku = (product: Product, sku: ProductSku) => {
    if (!deps.requireActiveShift()) return;
    if (tryAdd(product, merchSkuLine(product, sku))) setDialog(null);
  };

  const confirmCustomization = () => {
    if (dialog?.kind !== "customize") return;
    if (!deps.requireActiveShift()) return;
    const { product, value } = dialog;
    const { variantName, variantAdj, modifierNames, modifierAdj, unitPrice } =
      computeCustomizationPrice(product, value);
    const added = tryAdd(
      product,
      catalogLine(product, {
        id: `${product.id}::${variantName ?? ""}::${modifierNames.join(",")}`,
        price: unitPrice,
        quantity: value.quantity,
        variantName,
        modifierNames,
        variantPriceAdj: variantAdj,
        modifierPriceAdj: modifierAdj,
        notes: value.notes,
      })
    );
    if (added) setDialog(null);
  };

  const updateCustomization = (value: SelectedCustomization | null) => {
    setDialog((current) =>
      value && current?.kind === "customize" ? { ...current, value } : null
    );
  };

  return {
    dialog,
    closeDialog: () => setDialog(null),
    openProduct,
    applyOffer,
    confirmGiftCard,
    selectMerchSku,
    confirmCustomization,
    updateCustomization,
  };
}
