// Keranjang storefront publik: aturan murni (tanpa I/O) yang dipakai klien.

import type { CatalogProduct, CatalogSku } from "./types";

export type CartLine = {
  key: string;
  productId: string;
  skuId: string | null;
  name: string;
  variantName: string | null;
  price: number;
  quantity: number;
};

/** Tambah satu unit; produk/varian yang sama menambah qty baris yang ada. */
export function addCartLine(
  lines: CartLine[],
  product: Pick<CatalogProduct, "id" | "name" | "price">,
  sku: Pick<CatalogSku, "id" | "name" | "price"> | null
): CartLine[] {
  const key = sku ? `${product.id}::${sku.id}` : product.id;
  if (lines.some((line) => line.key === key)) {
    return lines.map((line) => (line.key === key ? { ...line, quantity: line.quantity + 1 } : line));
  }
  return [
    ...lines,
    {
      key,
      productId: product.id,
      skuId: sku?.id ?? null,
      name: product.name,
      variantName: sku?.name ?? null,
      price: sku ? sku.price : product.price,
      quantity: 1,
    },
  ];
}

/** Ubah qty; baris yang qty-nya habis (≤ 0) dibuang. */
export function changeCartQuantity(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines
    .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
    .filter((line) => line.quantity > 0);
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

/** Baca keranjang tersimpan; data korup atau bukan array → keranjang kosong. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
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
