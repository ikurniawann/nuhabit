"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Package, Save, Search } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PosProductXp } from "../types";
import { PRODUCT_XP_PAGE_SIZE, filterProducts } from "../settings-forms";
import { useSaveProductXp } from "../queries";
import { inputClass } from "./settings-ui";

export function ProductXpSection({ products, loading }: { products: PosProductXp[]; loading: boolean }) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const saveMutation = useSaveProductXp((productId) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    })
  );

  const filtered = filterProducts(products, search);
  const visible = filtered.slice(0, PRODUCT_XP_PAGE_SIZE);

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-col gap-3 border-b border-gray-200/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-brand-text" />
          XP Produk
        </CardTitle>
        <label className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama / SKU / kategori..."
            className="h-10 bg-white pl-10 text-sm focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </label>
      </CardHeader>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        XP tambahan per produk (di luar aturan nominal transaksi). Hanya keluar bila pembayaran penuh ARK Coin.
      </p>

      {loading ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Memuat produk...</div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {search.trim() ? "Tidak ada produk yang cocok." : "Belum ada produk POS."}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {visible.map((product) => {
            const draftValue = drafts[product.id] ?? String(product.xp);
            const isDirty = (Number(draftValue) || 0) !== product.xp;
            const isSaving = saveMutation.isPending && saveMutation.variables?.productId === product.id;
            return (
              <div key={product.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_120px_110px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{product.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{product.sku}</span>
                    <span>{product.category?.name || "Tanpa kategori"}</span>
                    <span>{formatRupiah(product.base_price)}</span>
                  </div>
                </div>
                <Input
                  type="number"
                  min={0}
                  value={draftValue}
                  onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: event.target.value }))}
                  className={`h-9 ${inputClass}`}
                  aria-label={`XP ${product.name}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveMutation.mutate({ productId: product.id, xp: Math.max(0, Number(draftValue) || 0) })}
                  disabled={!isDirty || isSaving}
                  className="h-9"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isDirty ? (
                    <Save className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {isSaving ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            );
          })}
          {filtered.length > visible.length ? (
            <div className="px-4 py-3 text-center text-xs text-muted-foreground">
              Menampilkan {visible.length} dari {filtered.length} produk — persempit lewat pencarian.
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
