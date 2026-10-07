// Keranjang storefront publik: aturan murni (tanpa I/O) yang dipakai klien.

import type { CatalogCollection, CatalogProduct, CatalogSku } from "./types";

export type CartLine = {
  key: string;
  productId: string;
  skuId: string | null;
  name: string;
  variantName: string | null;
  price: number;
  quantity: number;
  /** Batas pre-order (YYYY-MM-DD) bila baris ini dijual pre-order. */
  preorderUntil: string | null;
};

type LineProduct = Pick<CatalogProduct, "id" | "name" | "price"> &
  Partial<Pick<CatalogProduct, "preorder" | "preorderUntil">>;
type LineSku = Pick<CatalogSku, "id" | "name" | "price"> & Partial<Pick<CatalogSku, "preorder">>;

export const cartLineKey = (productId: string, skuId: string | null) =>
  skuId ? `${productId}::${skuId}` : productId;

/** Baris baru untuk produk/varian; qty minimal 1. */
export function makeCartLine(product: LineProduct, sku: LineSku | null, quantity = 1): CartLine {
  const preorder = sku ? sku.preorder === true : product.preorder === true;
  return {
    key: cartLineKey(product.id, sku?.id ?? null),
    productId: product.id,
    skuId: sku?.id ?? null,
    name: product.name,
    variantName: sku?.name ?? null,
    price: sku ? sku.price : product.price,
    quantity: Math.max(1, Math.floor(quantity)),
    preorderUntil: preorder ? (product.preorderUntil ?? null) : null,
  };
}

/** Tambah qty; produk/varian yang sama menambah qty baris yang ada. */
export function addCartLine(
  lines: CartLine[],
  product: LineProduct,
  sku: LineSku | null,
  quantity = 1
): CartLine[] {
  const line = makeCartLine(product, sku, quantity);
  if (lines.some((existing) => existing.key === line.key)) {
    return lines.map((existing) =>
      existing.key === line.key ? { ...existing, quantity: existing.quantity + line.quantity } : existing
    );
  }
  return [...lines, line];
}

/** Ubah qty; baris yang qty-nya habis (≤ 0) dibuang. */
export function changeCartQuantity(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines
    .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
    .filter((line) => line.quantity > 0);
}

/**
 * Ganti varian (ukuran) sebuah baris tanpa mengubah qty-nya. Bila varian
 * tujuan sudah ada di keranjang, qty-nya digabung ke baris itu.
 */
export function changeCartVariant(
  lines: CartLine[],
  key: string,
  product: LineProduct,
  sku: LineSku
): CartLine[] {
  const current = lines.find((line) => line.key === key);
  if (!current) return lines;
  const replacement = makeCartLine(product, sku, current.quantity);
  if (replacement.key === key) return lines;
  const existing = lines.find((line) => line.key === replacement.key);
  if (existing) {
    return lines
      .filter((line) => line.key !== key)
      .map((line) =>
        line.key === replacement.key ? { ...line, quantity: line.quantity + current.quantity } : line
      );
  }
  return lines.map((line) => (line.key === key ? replacement : line));
}

export function removeCartLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((line) => line.key !== key);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

/** Sidik isi keranjang: tarif ongkir hanya berlaku untuk sidik yang sama. */
export function cartSignature(lines: CartLine[]): string {
  return lines.map((line) => `${line.key}:${line.quantity}`).join("|");
}

export type StoredCart = { lines: CartLine[]; note: string };

const isLine = (value: unknown): value is CartLine =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CartLine).key === "string" &&
  typeof (value as CartLine).productId === "string" &&
  typeof (value as CartLine).quantity === "number";

/**
 * Baca keranjang tersimpan. Menerima format lama (array baris) dan format
 * baru ({ lines, note }); data korup dibaca sebagai keranjang kosong.
 */
export function parseStoredCart(raw: string | null): StoredCart {
  const empty: StoredCart = { lines: [], note: "" };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    const lines = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as StoredCart).lines)
        ? (parsed as StoredCart).lines
        : [];
    const note =
      !Array.isArray(parsed) && typeof (parsed as StoredCart)?.note === "string"
        ? (parsed as StoredCart).note
        : "";
    return {
      lines: lines.filter(isLine).map((line) => ({ ...line, preorderUntil: line.preorderUntil ?? null })),
      note,
    };
  } catch {
    return empty;
  }
}

export type CollectionGroup = { id: string; name: string; products: CatalogProduct[] };

/**
 * Kelompokkan produk per koleksi mengikuti urutan `collections`; produk
 * tanpa koleksi masuk grup "Lainnya" di akhir. Satu grup saja berarti
 * storefront tampil sebagai grid datar.
 */
export function groupByCollection(
  products: CatalogProduct[],
  collections: CatalogCollection[]
): CollectionGroup[] {
  const groups = collections.map((collection) => ({ ...collection, products: [] as CatalogProduct[] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const others: CatalogProduct[] = [];
  for (const product of products) {
    const group = product.collection ? byId.get(product.collection.id) : undefined;
    if (group) group.products.push(product);
    else others.push(product);
  }
  const filled = groups.filter((group) => group.products.length > 0);
  if (others.length > 0) filled.push({ id: "lainnya", name: "Lainnya", products: others });
  return filled;
}

export type CheckoutForm = {
  name: string;
  phone: string;
  address: string;
  hasArea: boolean;
  hasRate: boolean;
};

/** Pesan galat pertama untuk form checkout, atau null bila siap dibayar. */
export function checkoutFormError(form: CheckoutForm): string | null {
  if (form.name.trim().length < 2) return "Nama penerima wajib diisi";
  if (form.phone.replace(/\D/g, "").length < 8) return "Nomor WA tidak valid";
  if (!form.hasArea) return "Pilih area tujuan dulu";
  if (form.address.trim().length < 10) return "Alamat lengkap minimal 10 karakter";
  if (!form.hasRate) return "Pilih kurir dulu";
  return null;
}
