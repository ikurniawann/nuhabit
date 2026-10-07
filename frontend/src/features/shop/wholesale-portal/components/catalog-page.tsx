"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, ShoppingBag, X } from "lucide-react";
import { formatDate, formatRupiah } from "@/lib/format";
import { groupByCollection } from "@/lib/shop/storefront-cart";
import type { CatalogProduct } from "@/lib/shop/types";
import { usePlaceWholesaleOrder, useWholesaleCatalog, type WholesaleProduct, type WholesaleSku } from "../queries";
import { TERMS_LABEL } from "./order-status";
import { useRequireAccount } from "./use-require-account";

type Pick = { productId: string; skuId: string | null; name: string; price: number; qty: number; minQty: number };

const pickKey = (productId: string, skuId: string | null) => (skuId ? `${productId}::${skuId}` : productId);

const sellable = (stock: number, preorder: boolean) => stock > 0 || preorder;

/** /wholesale/catalog: harga mitra, minimal qty per produk, pesan sekaligus. */
export function WholesaleCatalogPage() {
  const router = useRouter();
  const { account, loading } = useRequireAccount();
  const catalog = useWholesaleCatalog(account !== null);
  const place = usePlaceWholesaleOrder();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const products = useMemo(() => catalog.data ?? [], [catalog.data]);
  const groups = useMemo(() => {
    // groupByCollection hanya membaca id dan collection; cast cukup untuk itu.
    const collections = Array.from(
      new Map(products.flatMap((p) => (p.collection ? [[p.collection.id, p.collection]] : []))).values()
    );
    return groupByCollection(products as unknown as CatalogProduct[], collections).map((group) => ({
      ...group,
      products: group.products as unknown as WholesaleProduct[],
    }));
  }, [products]);

  const lines = Object.values(picks).filter((pick) => pick.qty > 0);
  const subtotal = lines.reduce((sum, pick) => sum + pick.price * pick.qty, 0);
  const totalQty = lines.reduce((sum, pick) => sum + pick.qty, 0);
  const minOrder = account?.min_order_idr ?? 0;
  const underMin = lines.find((pick) => pick.qty < pick.minQty);

  const setQty = (product: WholesaleProduct, sku: WholesaleSku | null, qty: number) => {
    const key = pickKey(product.id, sku?.id ?? null);
    setPicks((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[key];
        return next;
      }
      next[key] = {
        productId: product.id,
        skuId: sku?.id ?? null,
        name: sku ? `${product.name} (${sku.name})` : product.name,
        price: sku ? sku.price : product.price,
        qty: Math.floor(qty),
        minQty: product.minQty,
      };
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (address.trim().length < 10) {
      setFormError("Alamat pengiriman minimal 10 karakter");
      return;
    }
    setFormError(null);
    place.mutate(
      {
        items: lines.map((pick) => ({ product_id: pick.productId, sku_id: pick.skuId, quantity: pick.qty })),
        shipping_address: address.trim(),
        notes: notes.trim() || null,
      },
      {
        onSuccess: (result) => {
          setPicks({});
          setSheetOpen(false);
          if (result.invoice_url) window.location.assign(result.invoice_url);
          else router.push(`/wholesale/orders/${result.id}`);
        },
        onError: (error) => setFormError(error.message),
      }
    );
  };

  if (loading || !account) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Katalog mitra</p>
          <h1 className="text-2xl font-bold">
            Harga khusus {account.company_name}
            <span className="text-forest">.</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Diskon {account.discount_pct}% dari harga retail kecuali produk berharga wholesale khusus.
            {minOrder > 0 ? ` Minimal pesanan ${formatRupiah(minOrder)}.` : ""} Pembayaran:{" "}
            {TERMS_LABEL[account.payment_terms]}.
          </p>
        </div>
      </div>

      {catalog.isPending ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-forest" />
        </div>
      ) : catalog.isError ? (
        <p className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">{catalog.error.message}</p>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-muted-foreground">
          <ShoppingBag className="h-10 w-10 opacity-40" />
          <p className="text-sm">Belum ada produk di katalog</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="mb-8">
            {groups.length > 1 ? <h2 className="mb-3 text-base font-semibold">{group.name}</h2> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  qtyOf={(skuId) => picks[pickKey(product.id, skuId)]?.qty ?? 0}
                  onQty={(sku, qty) => setQty(product, sku, qty)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-ink text-on-ink shadow-float">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs text-on-ink-muted">{totalQty} pcs · {lines.length} baris</p>
              <p className="text-base font-semibold">{formatRupiah(subtotal)}</p>
              {underMin ? (
                <p className="text-xs text-on-ink-muted">Minimal {underMin.minQty} pcs untuk {underMin.name}</p>
              ) : subtotal < minOrder ? (
                <p className="text-xs text-on-ink-muted">Minimal pesanan {formatRupiah(minOrder)}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              disabled={underMin !== undefined || subtotal < minOrder}
              className="rounded-full bg-accent-strong px-5 py-2.5 text-sm font-semibold text-accent-foreground hover:bg-accent-dark disabled:opacity-50"
            >
              Buat Pesanan
            </button>
          </div>
        </div>
      ) : null}

      {sheetOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center" onClick={() => setSheetOpen(false)}>
          <form
            onSubmit={submit}
            role="dialog"
            aria-label="Konfirmasi pesanan"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-card bg-card p-5 shadow-float sm:rounded-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-bold">Konfirmasi pesanan</h2>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Tutup">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <ul className="mb-4 divide-y divide-border text-sm">
              {lines.map((pick) => (
                <li key={pickKey(pick.productId, pick.skuId)} className="flex justify-between py-1.5">
                  <span>
                    {pick.name} <span className="text-muted-foreground">× {pick.qty}</span>
                  </span>
                  <span>{formatRupiah(pick.price * pick.qty)}</span>
                </li>
              ))}
              <li className="flex justify-between py-2 font-semibold">
                <span>Subtotal</span>
                <span>{formatRupiah(subtotal)}</span>
              </li>
            </ul>
            <label className="mb-3 block space-y-1.5 text-sm font-medium">
              Alamat pengiriman
              <textarea
                required
                rows={3}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Nama penerima, jalan, kota, kode pos"
                className="w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-forest"
              />
            </label>
            <label className="mb-3 block space-y-1.5 text-sm font-medium">
              Catatan (opsional)
              <textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-forest"
              />
            </label>
            <p className="mb-4 rounded-2xl bg-surface px-3 py-2 text-xs text-body">
              {account.payment_terms === "invoice"
                ? "Setelah pesanan dibuat, Anda diarahkan ke invoice Xendit. Ongkir diatur tim NüHabit setelah pembayaran."
                : "Pesanan dikirim lebih dulu; tagihan jatuh tempo 30 hari sejak pesanan dibuat."}
            </p>
            {formError ? (
              <p role="alert" className="mb-3 rounded-2xl bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={place.isPending}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent-strong text-sm font-semibold text-accent-foreground hover:bg-accent-dark disabled:opacity-60"
            >
              {place.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {account.payment_terms === "invoice" ? "Buat pesanan & bayar" : "Buat pesanan"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProductCard({
  product,
  qtyOf,
  onQty,
}: {
  product: WholesaleProduct;
  qtyOf: (skuId: string | null) => number;
  onQty: (sku: WholesaleSku | null, qty: number) => void;
}) {
  const image = product.images[0] || product.imageUrl;
  const rows: Array<{ sku: WholesaleSku | null; label: string; price: number; retail: number; stock: number; preorder: boolean }> =
    product.skus.length > 0
      ? product.skus.map((sku) => ({ sku, label: sku.name, price: sku.price, retail: sku.retailPrice, stock: sku.stock, preorder: sku.preorder }))
      : [{ sku: null, label: "Qty", price: product.price, retail: product.retailPrice, stock: product.stock, preorder: product.preorder }];

  return (
    <article className="flex gap-4 rounded-card bg-card p-4 shadow-card">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Package className="h-8 w-8 text-silver" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{product.name}</h3>
        <p className="text-xs text-muted-foreground">
          Min. {product.minQty} pcs
          {product.preorderUntil && product.preorder ? ` · pre-order, kirim ${formatDate(product.preorderUntil)}` : ""}
        </p>
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const available = sellable(row.stock, row.preorder);
            const qty = qtyOf(row.sku?.id ?? null);
            return (
              <div key={row.sku?.id ?? "single"} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {row.sku ? <span className="font-medium">{row.label}</span> : null}{" "}
                  <span className="text-xs text-muted-foreground">
                    {row.stock > 0 ? `stok ${row.stock}` : row.preorder ? "pre-order" : "habis"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-right">
                    <span className="block font-semibold">{formatRupiah(row.price)}</span>
                    {row.retail !== row.price ? (
                      <span className="block text-[11px] text-silver line-through">{formatRupiah(row.retail)}</span>
                    ) : null}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    step={1}
                    disabled={!available}
                    value={qty === 0 ? "" : qty}
                    placeholder="0"
                    aria-label={`Qty ${product.name}${row.sku ? ` ${row.label}` : ""}`}
                    onChange={(event) => onQty(row.sku, Number(event.target.value) || 0)}
                    onFocus={() => {
                      if (qty === 0 && available) onQty(row.sku, product.minQty);
                    }}
                    className="h-9 w-16 rounded-full border border-border bg-card px-2 text-center text-sm outline-none focus:border-forest disabled:opacity-40"
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
