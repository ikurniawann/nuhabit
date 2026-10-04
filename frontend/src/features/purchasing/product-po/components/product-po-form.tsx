"use client";

import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { VendorPOForm } from "@/features/purchasing/po/components/vendor-po/vendor-po-form";
import {
  emptyProductItem,
  isVariantProduct,
  productItemsFromPR,
  toProductPayloadItems,
  validateProductPO,
  withProduct,
  type ProductPOItemRow,
} from "../form-items";
import type { ApprovedProductPRForPO, ProductPOFormData, ProductPOFormInput } from "../types";

interface ProductPOFormProps {
  lookups: ProductPOFormData;
  approvedPRs: ApprovedProductPRForPO[];
  initialPRId?: string;
  onSubmit: (data: ProductPOFormInput) => Promise<void>;
  isLoading: boolean;
  cancelHref: string;
}

/** Form PO produk; harga acuan dari master produk, produk ber-varian wajib memilih SKU. */
export function ProductPOForm({ lookups, approvedPRs, initialPRId, onSubmit, isLoading, cancelHref }: ProductPOFormProps) {
  const { vendors, products, units } = lookups;
  const findProduct = (id: string) => products.find((p) => p.id === id);
  const itemsFromPR = (prId: string) => {
    const pr = approvedPRs.find((entry) => entry.id === prId);
    const rows = pr ? productItemsFromPR(pr, products) : [];
    return rows.length ? rows : null;
  };

  return (
    <VendorPOForm<ProductPOItemRow>
      vendors={vendors}
      approvedPRs={approvedPRs}
      initialPRId={initialPRId}
      initialItems={(initialPRId && itemsFromPR(initialPRId)) || [emptyProductItem()]}
      emptyItem={emptyProductItem}
      itemsFromPR={itemsFromPR}
      validate={(vendorId, items) => validateProductPO(vendorId, items, products)}
      isLoading={isLoading}
      cancelHref={cancelHref}
      onSubmit={(header, items) => onSubmit({ ...header, items: toProductPayloadItems(items) })}
      renderPicker={(row, setRow) => (
        <>
          <Label className="text-xs">Produk</Label>
          <Combobox
            options={products.map((p) => ({ value: p.id, label: p.nama, description: p.kode }))}
            value={row.product_id}
            onChange={(value) => {
              const product = findProduct(value);
              if (product) setRow(withProduct(row, product, units));
            }}
            placeholder="Pilih produk..."
            searchPlaceholder="Cari..."
            emptyMessage="Produk tidak ditemukan"
            className="h-9 text-sm"
          />
        </>
      )}
      renderExtra={(row, setRow) => {
        const product = findProduct(row.product_id);
        if (!isVariantProduct(product)) return null;
        return (
          <div className="space-y-1.5 md:col-span-4">
            <Label className="text-xs">
              SKU / Varian <span className="text-red-500">*</span>
            </Label>
            <Combobox
              options={(product?.pos_skus ?? []).map((sku) => ({ value: sku.id, label: `${sku.sku}, ${sku.name}` }))}
              value={row.pos_sku_id || ""}
              onChange={(value) => setRow({ ...row, pos_sku_id: value || null })}
              placeholder="Pilih SKU (ukuran/warna)..."
              searchPlaceholder="Cari SKU..."
              emptyMessage="SKU tidak ditemukan"
              className="h-9 text-sm"
            />
          </div>
        );
      }}
    />
  );
}
