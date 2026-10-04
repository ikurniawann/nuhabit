"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Pencil, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { formatNumber } from "@/lib/format";
import { displayName, hasRecipe, matchesItemKeyword, paginate } from "@/lib/purchasing/production-ui-display";
import type { ProductionProduct } from "../types";

const PAGE_SIZE = 10;

type ProductionItemsSectionProps = {
  isProduct: boolean;
  items: ProductionProduct[];
  loading: boolean;
  bomEditorRoute: (id: string) => string;
  onCreateOrder: (item: ProductionProduct) => void;
};

export function ProductionItemsSection({
  isProduct,
  items,
  loading,
  bomEditorRoute,
  onCreateOrder,
}: ProductionItemsSectionProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const filtered = useMemo(() => items.filter((item) => matchesItemKeyword(item, search)), [items, search]);
  const { rows, totalPages } = paginate(filtered, page, PAGE_SIZE);
  const columnCount = isProduct ? 6 : 5;

  return (
    <PurchasingListSection
      icon={Box}
      title={isProduct ? "Produk untuk Produksi" : "Bahan Baku untuk Produksi"}
      description={
        isProduct
          ? "Produk dengan resep (BOM) lengkap dapat diubah menjadi order produksi."
          : "Bahan baku dengan resep (BOM) lengkap dapat diproduksi internal."
      }
      toolbar={
        <label className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder={isProduct ? "Cari nama, kode, atau kategori produk..." : "Cari nama atau kode bahan baku..."}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
              aria-label="Hapus pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      }
    >
      <div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{isProduct ? "Produk" : "Bahan Baku"}</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Komponen</th>
                <th className="px-4 py-3 text-right font-semibold">Estimasi HPP</th>
                {isProduct && <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>}
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-gray-500">
                    {isProduct ? "Memuat produk..." : "Memuat bahan baku..."}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-gray-500">
                    Tidak ada {isProduct ? "produk" : "bahan baku"} yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                rows.map((item) => {
                  const ready = hasRecipe(item);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{displayName(item.nama)}</p>
                        <p className="text-xs text-gray-500">
                          {item.kode || "-"}
                          {item.kategori ? ` · ${item.kategori}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            ready
                              ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                              : "border-amber-200/80 bg-amber-50 text-amber-700"
                          }
                        >
                          {ready ? "Siap diproduksi" : "Resep (BOM) belum lengkap"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {formatNumber(item.total_bahan_baku, 3)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-pink-700">
                        {formatNumber(item.hpp_estimasi)}
                      </td>
                      {isProduct && (
                        <td className="px-4 py-3 text-right text-gray-700">{formatNumber(item.harga_jual)}</td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Link href={`${bomEditorRoute(item.id)}?from=production`}>
                            <Button variant="ghost" size="sm" title="Edit resep" className="cursor-pointer">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Buat order produksi"
                            className="cursor-pointer disabled:opacity-40"
                            disabled={!ready}
                            onClick={() => onCreateOrder(item)}
                          >
                            <Box className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <PurchasingTablePagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </div>
    </PurchasingListSection>
  );
}
