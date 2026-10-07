"use client";

import { useState, type FormEvent } from "react";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveProductSettings, type WholesaleProductRow } from "../queries";

/** Harga wholesale, minimal qty dan batas pre-order satu produk. */
export function ProductSettingsModal({ product, onClose }: { product: WholesaleProductRow; onClose: () => void }) {
  const [price, setPrice] = useState(product.wholesale_price_idr === null ? "" : String(product.wholesale_price_idr));
  const [minQty, setMinQty] = useState(String(product.wholesale_min_qty));
  const [preorderUntil, setPreorderUntil] = useState(product.preorder_until ?? "");
  const save = useSaveProductSettings();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        id: product.id,
        form: {
          preorder_until: preorderUntil || null,
          wholesale_price_idr: price.trim() === "" ? null : Number(price),
          wholesale_min_qty: Math.max(1, Math.floor(Number(minQty) || 1)),
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
      description="Kosongkan harga wholesale agar mitra memakai diskon akunnya. Pre-order membuat produk tetap bisa dibeli saat stok 0 sampai tanggal itu."
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
    </FormModal>
  );
}
