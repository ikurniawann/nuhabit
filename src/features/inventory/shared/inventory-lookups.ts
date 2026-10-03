"use client";

import { useQuery } from "@tanstack/react-query";

/** Data pilihan bersama halaman inventori (gudang, bahan baku) + format angka. */

export type WarehouseLookup = { id: string; name: string; code: string };
export type MaterialLookup = { id: string; kode: string; nama: string; satuan: string | null };

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || "Permintaan gagal");
  return body as T;
}

export function useWarehouseLookup() {
  return useQuery({
    queryKey: ["inventory-lookup", "warehouses"],
    queryFn: async () => (await fetchJson<{ data?: WarehouseLookup[] }>("/api/purchasing/warehouses")).data ?? [],
    staleTime: 5 * 60_000,
  });
}

export function useMaterialLookup() {
  return useQuery({
    queryKey: ["inventory-lookup", "materials"],
    queryFn: async () => (await fetchJson<{ data: MaterialLookup[] }>("/api/inventory/materials")).data,
    staleTime: 5 * 60_000,
  });
}

const qtyFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const rupiahFormat = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export const formatQty = (value: number | null | undefined) => qtyFormat.format(Number(value || 0));
export const formatRupiah = (value: number | null | undefined) => rupiahFormat.format(Number(value || 0));

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
