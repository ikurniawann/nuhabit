"use client";

import { useQuery } from "@tanstack/react-query";

export interface PromoCatalog {
  products: Array<{ id: string; name: string; price: string; category_id: string | null }>;
  categories: Array<{ id: string; name: string }>;
}

async function fetchPromoCatalog(): Promise<PromoCatalog> {
  const res = await fetch("/api/promo/catalog", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Gagal memuat katalog");
  return body.data;
}

/** Produk & kategori POS untuk pemilih target (cache 5 menit). */
export const usePromoCatalog = () =>
  useQuery({
    queryKey: ["promo", "catalog"],
    queryFn: fetchPromoCatalog,
    staleTime: 5 * 60_000,
  });
