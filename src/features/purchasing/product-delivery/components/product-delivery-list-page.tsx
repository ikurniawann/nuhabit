"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { formatDate } from "@/lib/format";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_OPTIONS,
  DELIVERY_STATUS_STYLES,
} from "@/lib/purchasing/receiving-ui-delivery";
import { useProductDeliveryList, useProductDeliveryPOOptions } from "../queries";
import type { ProductDeliveryStatus } from "../types";
import { Eye, Filter, Plus, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";

const DELIVERY_INSERT = `${PRODUCT_ROUTES.purchasingDelivery}/insert`;
const deliveryDetailHref = (id: string) => `${PRODUCT_ROUTES.purchasingDelivery}/${id}`;

export function ProductDeliveryListPage() {
  const urlPoId = useSearchParams().get("po_id");
  // key: filter PO diisi ulang bila ?po_id= berubah.
  return <ProductDeliveryListContent key={urlPoId ?? ""} urlPoId={urlPoId} />;
}

function ProductDeliveryListContent({ urlPoId }: { urlPoId: string | null }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductDeliveryStatus | "all">("all");
  const [poFilter, setPoFilter] = useState(urlPoId || "all");
  const [filterOpen, setFilterOpen] = useState(Boolean(urlPoId));
  const [page, setPage] = useState(1);
  const limit = 10;
  const selectedPoId = poFilter !== "all" ? poFilter : null;

  const listQuery = useProductDeliveryList({
    page,
    limit,
    status: statusFilter !== "all" ? statusFilter : undefined,
    po_id: poFilter !== "all" ? poFilter : undefined,
    search: search || undefined,
  });
  const deliveries = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const poOptionsQuery = useProductDeliveryPOOptions(true);
  const purchaseOrders = poOptionsQuery.data ?? [];

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(
        listQuery.error instanceof Error ? listQuery.error.message : "Gagal memuat pengiriman"
      );
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  function handleResetFilters() {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setPoFilter("all");
    setPage(1);
  }

  const isFilterActive = statusFilter !== "all" || poFilter !== "all";
  const activeFilterCount = Number(statusFilter !== "all") + Number(poFilter !== "all");
  const poOptions = [
    { value: "all", label: "Semua PO" },
    ...purchaseOrders.map((po) => ({
      value: po.id,
      label: po.nama_supplier ? `${po.nomor_po} - ${po.nama_supplier}` : po.nomor_po,
    })),
  ];

  const createHref = selectedPoId ? `${DELIVERY_INSERT}?po_id=${selectedPoId}` : DELIVERY_INSERT;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Lacak Pengiriman"
        description={`Lacak surat jalan dan pengiriman per purchase order — total ${total}`}
        actions={
          <Link href={createHref}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Tambah Pengiriman
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={Truck}
        title="Daftar Pengiriman"
        description="Pantau pengiriman berdasarkan purchase order, nomor surat jalan, ekspedisi, nomor resi, estimasi tiba, dan status."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari surat jalan, nomor resi, atau ekspedisi..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Bersihkan pencarian"
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
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Atur Ulang
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
                    Status
                  </div>
                  <Combobox
                    options={DELIVERY_STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as ProductDeliveryStatus | "all");
                      setPage(1);
                    }}
                    placeholder="Filter status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Truck className="h-3.5 w-3.5 text-pink-500" />
                    Purchase Order
                  </div>
                  <Combobox
                    options={poOptions}
                    value={poFilter}
                    onChange={(value) => {
                      setPoFilter(value || "all");
                      setPage(1);
                    }}
                    placeholder="Filter purchase order..."
                    searchPlaceholder="Cari nomor purchase order..."
                    emptyMessage="Purchase order tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {listQuery.isLoading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
              <p className="mt-2 text-sm text-gray-500">Memuat pengiriman...</p>
            </div>
          ) : deliveries.length === 0 ? (
            <div className="py-14 text-center">
              <Truck className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Tidak ada pengiriman yang sesuai dengan filter saat ini</p>
              <Link href={createHref}>
                <Button variant="outline" className="mt-4 purchasing-secondary-button">
                  Tambah Pengiriman Pertama
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">No. Surat Jalan</th>
                      <th className="px-4 py-3 text-left font-semibold">Purchase Order</th>
                      <th className="px-4 py-3 text-left font-semibold">Ekspedisi</th>
                      <th className="px-4 py-3 text-left font-semibold">No. Resi</th>
                      <th className="px-4 py-3 text-left font-semibold">Tanggal Kirim</th>
                      <th className="px-4 py-3 text-left font-semibold">Estimasi Tiba</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deliveries.map((d) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={deliveryDetailHref(d.id)}
                            className="font-medium text-gray-900 hover:text-pink-700 hover:underline"
                          >
                            {d.no_surat_jalan || "-"}
                          </Link>
                          <div className="text-xs text-gray-500">{d.delivery_number || "-"}</div>
                        </td>
                        <td className="px-4 py-3">
                          {d.po_id && d.po_number && d.po_number !== "-" ? (
                            <Link
                              href={PRODUCT_ROUTES.purchasingPoDetail(d.po_id)}
                              className="font-medium text-pink-700 hover:underline"
                            >
                              {d.po_number}
                            </Link>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{d.ekspedisi || "-"}</td>
                        <td className="px-4 py-3 font-mono text-xs">{d.no_resi || "-"}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(d.tanggal_kirim)}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(d.tanggal_estimasi_tiba)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={DELIVERY_STATUS_STYLES[d.status]}>
                            {DELIVERY_STATUS_LABELS[d.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={deliveryDetailHref(d.id)}>
                            <Button size="sm" variant="ghost" title="Lihat detail" className="cursor-pointer">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}
