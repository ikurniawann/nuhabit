"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { Boxes, Eye, PackageMinus, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useSupplyStockList, useSupplyInventoryFormData } from "../queries";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";


export function SupplyInventoryListPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [lowStock, setLowStock] = useState(false);

  const formData = useSupplyInventoryFormData();
  const listQuery = useSupplyStockList({
    search: search || undefined,
    warehouse_id: warehouseId !== "all" ? warehouseId : undefined,
    low_stock: lowStock,
  });

  const rows = listQuery.data ?? [];

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(listQuery.error instanceof Error ? listQuery.error.message : "Gagal memuat stok");
    }
  }, [listQuery.isError, listQuery.error]);

  const warehouseOptions = useMemo(
    () => [
      { value: "all", label: "Semua Gudang" },
      ...(formData.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
    ],
    [formData.data]
  );

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Stok Barang Operasional"
        description="Saldo stok riil barang operasional (stockable) per gudang"
        actions={
          <div className="flex gap-2">
            <Link href={GENERAL_ROUTES.inventoryUsage}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <PackageMinus className="mr-2 h-4 w-4" />
                Pemakaian
              </Button>
            </Link>
            <Link href={GENERAL_ROUTES.inventoryAdjustment}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Penyesuaian
              </Button>
            </Link>
          </div>
        }
      />

      <PurchasingListSection
        icon={Boxes}
        title="Daftar Stok"
        description="Saldo per (barang, gudang). Barang habis pakai (non-stockable) tidak muncul di sini."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nama/kode barang..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  aria-label="Bersihkan"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Combobox
              options={warehouseOptions}
              value={warehouseId}
              onChange={(v) => setWarehouseId(v || "all")}
              placeholder="Gudang..."
              className="!w-full md:!w-56 h-10 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setLowStock((v) => !v)}
              className={
                lowStock
                  ? "h-10 gap-2 rounded-lg border-amber-500 bg-amber-500 px-3 text-sm font-semibold !text-white hover:!bg-amber-600"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:!border-amber-200 hover:!bg-amber-50"
              }
            >
              Stok Menipis
            </Button>
          </div>
        }
      >
        {listQuery.isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Memuat stok...</div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <Boxes className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">Belum ada stok barang operasional.</p>
            <p className="mt-1 text-xs text-gray-400">
              Stok muncul otomatis setelah barang stockable diterima lewat penerimaan barang.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Barang</th>
                  <th className="px-4 py-3 text-left font-semibold">Gudang</th>
                  <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-3 text-right font-semibold">Min</th>
                  <th className="px-4 py-3 text-right font-semibold">HPP Rata²</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const low = r.qty_available <= r.qty_minimum;
                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(GENERAL_ROUTES.inventoryDetail(r.id))}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{r.item_kode || "-"}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={GENERAL_ROUTES.inventoryDetail(r.id)}
                          className="font-medium text-pink-700 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.item_nama || "-"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.warehouse_nama || "-"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatNumber(r.qty_available, 3)} <span className="text-xs text-gray-400">{r.satuan_nama || ""}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{formatNumber(r.qty_minimum, 3)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatRupiah(r.unit_cost)}</td>
                      <td className="px-4 py-3 text-center">
                        {low ? (
                          <Badge className="border-0 bg-amber-100 text-amber-700">Menipis</Badge>
                        ) : (
                          <Badge className="border-0 bg-emerald-100 text-emerald-700">Normal</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link href={GENERAL_ROUTES.inventoryDetail(r.id)}>
                          <Button variant="ghost" size="sm" title="Kartu stok">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {rows.length > 0 && (
        <p className="text-xs text-gray-400">
          Terakhir bergerak ditampilkan di kartu stok masing-masing barang · {formatDate(new Date())}
        </p>
      )}
    </div>
  );
}
