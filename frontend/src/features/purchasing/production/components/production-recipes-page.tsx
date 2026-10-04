"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BeakerIcon } from "@heroicons/react/24/outline";
import { Filter, Pencil, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatNumber } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { displayName, hasRecipe, matchesItemKeyword, paginate, toNumber } from "@/lib/purchasing/production-ui-display";
import { getProductionModuleConfig } from "../production-module";
import { useRecipeItems } from "../queries";

type BomFilter = "all" | "ready" | "incomplete";

const BOM_FILTER_OPTIONS = [
  { value: "all", label: "Semua Status Resep (BOM)" },
  { value: "ready", label: "Siap diproduksi" },
  { value: "incomplete", label: "Belum lengkap" },
];

const PAGE_SIZE = 10;

export function ProductionRecipesPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getProductionModuleConfig(moduleType);
  const isProduct = config.isProduct;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [bomFilter, setBomFilter] = useState<BomFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const productsQuery = useRecipeItems(moduleType);
  useErrorToast(productsQuery.error, "Gagal memuat daftar resep");
  const products = productsQuery.data ?? [];
  const loading = productsQuery.isLoading;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim().toLowerCase());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filteredProducts = products.filter(
    (product) =>
      matchesItemKeyword(product, search) &&
      (bomFilter === "all" || (bomFilter === "ready") === hasRecipe(product))
  );
  const { rows: paginatedProducts, totalPages } = paginate(filteredProducts, page, PAGE_SIZE);

  const withBom = products.filter(hasRecipe).length;
  const withoutBom = products.length - withBom;
  const isFilterActive = bomFilter !== "all";

  function handleResetFilters() {
    setSearch("");
    setSearchQuery("");
    setBomFilter("all");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={isProduct ? "Resep (BOM)" : "Resep Bahan Baku (BOM)"}
        description={
          <>
            {isProduct
              ? "Kelola komposisi bahan baku dan WIP untuk produk jadi"
              : "Kelola komponen bahan baku untuk bahan yang diproduksi internal"}
            {" — "}
            {products.length} total
          </>
        }
        actions={
          <>
            <Link href={config.productionHubRoute}>
              <Button
                variant="outline"
                className="h-10 w-full gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:w-auto"
              >
                Kembali ke Produksi
              </Button>
            </Link>
            <Link href={config.materialsInsertRoute}>
              <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
                <Plus className="h-4 w-4" />
                {isProduct ? "Tambah Produk" : "Tambah Bahan"}
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Total {isProduct ? "Produk" : "Bahan Baku"}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{products.length}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">Siap diproduksi</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{withBom}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-600">Resep (BOM) belum lengkap</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{withoutBom}</p>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={BeakerIcon}
        title={isProduct ? "Daftar Resep Produk" : "Daftar Resep Bahan Baku"}
        description="Pilih item untuk mengatur bahan baku, item WIP, susut, dan estimasi harga pokok penjualan."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={
                  isProduct
                    ? "Cari nama, kode, atau kategori produk..."
                    : "Cari nama atau kode bahan baku..."
                }
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  1
                </span>
              )}
            </Button>
            {(search || isFilterActive || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 shrink-0 rounded-lg"
              >
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Status Resep (BOM)
                  </div>
                  <Combobox
                    options={BOM_FILTER_OPTIONS}
                    value={bomFilter}
                    onChange={(value) => {
                      setBomFilter(value as BomFilter);
                      setPage(1);
                    }}
                    placeholder="Filter status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="w-full! h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">{isProduct ? "Produk" : "Bahan Baku"}</th>
                  <th className="px-4 py-3 text-left font-semibold">Status Resep (BOM)</th>
                  <th className="px-4 py-3 text-right font-semibold">Komponen</th>
                  <th className="px-4 py-3 text-right font-semibold">Estimasi HPP</th>
                  {isProduct && (
                    <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                  )}
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={isProduct ? 6 : 5} className="px-4 py-12 text-center text-sm text-gray-500">
                      Memuat resep {isProduct ? "produk" : "bahan baku"}...
                    </td>
                  </tr>
                ) : paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={isProduct ? 6 : 5} className="px-4 py-14 text-center">
                      <BeakerIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                      <p className="text-gray-500">
                        Tidak ada {isProduct ? "produk" : "bahan baku"} yang cocok dengan filter
                      </p>
                      <Link href={config.materialsInsertRoute}>
                        <Button
                          variant="outline"
                          className="mt-4 h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
                        >
                          {isProduct ? "Tambah Produk" : "Tambah Bahan"}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((product) => {
                    const componentCount = toNumber(product.total_bahan_baku);
                    const hasBom = hasRecipe(product);

                    return (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{displayName(product.nama)}</p>
                          <p className="text-xs text-gray-500">
                            {product.kode || "-"}
                            {product.kategori ? ` · ${product.kategori}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              hasBom
                                ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                : "border-amber-200/80 bg-amber-50 text-amber-700"
                            }
                          >
                            {hasBom ? "Siap diproduksi" : "Belum lengkap"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {componentCount}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-pink-700">
                          {formatNumber(product.hpp_estimasi)}
                        </td>
                        {isProduct && (
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatNumber(product.harga_jual)}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <Link href={`${config.bomEditorRoute(product.id)}?from=production`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Edit resep"
                              className="cursor-pointer"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && filteredProducts.length > 0 && (
            <PurchasingTablePagination
              page={page}
              totalPages={totalPages}
              totalItems={filteredProducts.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}
