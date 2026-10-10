"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah } from "@/lib/format";
import { checkSale, saleUntilInput } from "../product-settings";
import { useSaveProductSettings, type WholesaleProductRow } from "../queries";

/** Harga wholesale, minimal qty, batas pre-order, harga promo dan sorotan toko online satu produk. */
export function ProductSettingsModal({ product, onClose }: { product: WholesaleProductRow; onClose: () => void }) {
  const [price, setPrice] = useState(product.wholesale_price_idr === null ? "" : String(product.wholesale_price_idr));
  const [minQty, setMinQty] = useState(String(product.wholesale_min_qty));
  const [preorderUntil, setPreorderUntil] = useState(product.preorder_until ?? "");
  const [salePrice, setSalePrice] = useState(product.sale_price_idr === null ? "" : String(product.sale_price_idr));
  const [saleUntil, setSaleUntil] = useState(saleUntilInput(product.sale_until));
  const [isFeatured, setIsFeatured] = useState(product.is_featured);
  const [isNew, setIsNew] = useState(product.is_new);
  const save = useSaveProductSettings();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const sale = checkSale({ salePrice, saleUntil }, product.price);
    if (!sale.ok) {
      toast.error(sale.error);
      return;
    }
    save.mutate(
      {
        id: product.id,
        form: {
          preorder_until: preorderUntil || null,
          wholesale_price_idr: price.trim() === "" ? null : Number(price),
          wholesale_min_qty: Math.max(1, Math.floor(Number(minQty) || 1)),
          sale_price_idr: sale.sale_price_idr,
          sale_until: sale.sale_until,
          is_featured: isFeatured,
          is_new: isNew,
        },
      },
      { onSuccess: onClose }
    );
  };

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={product.name}
      description="Kosongkan harga wholesale agar mitra memakai diskon akunnya. Pre-order membuat produk tetap bisa dibeli saat stok 0 sampai tanggal itu. Harga promo tampil dicoret dengan harga normal di toko online."
      onSubmit={submit}
      submitLabel="Simpan"
      cancelLabel="Batal"
      loadingLabel="Menyimpan..."
      loading={save.isPending}
      size="xs"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ps-price">Harga wholesale (Rp, opsional)</Label>
        <Input id="ps-price" type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ikut diskon akun" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ps-min">Minimal qty per pesanan</Label>
        <Input id="ps-min" type="number" min={1} max={999} step={1} required value={minQty} onChange={(e) => setMinQty(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ps-preorder">Pre-order sampai (opsional)</Label>
        <Input id="ps-preorder" type="date" value={preorderUntil} onChange={(e) => setPreorderUntil(e.target.value)} />
      </div>
      <div className="space-y-1.5 border-t border-gray-100 pt-3">
        <Label htmlFor="ps-sale-price">Harga promo toko online (Rp, opsional)</Label>
        <Input id="ps-sale-price" type="number" min={0} step={1000} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={`Normal ${formatRupiah(product.price)}`} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ps-sale-until">Promo berakhir (opsional)</Label>
        <Input id="ps-sale-until" type="date" value={saleUntil} disabled={salePrice.trim() === ""} onChange={(e) => setSaleUntil(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-4 pt-1">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Produk unggulan (Featured)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Produk baru (New arrivals)
        </label>
      </div>
    </FormModal>
  );
}
