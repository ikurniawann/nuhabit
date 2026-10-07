"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UseQueryResult } from "@tanstack/react-query";
import { Eye, FileText, Filter, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { formatDate, formatRupiah } from "@/lib/format";
import { VENDOR_PO_STATUS_OPTIONS, vendorPoStatusBadge } from "@/lib/purchasing/po-ui-status";
import { ToneBadge } from "../po-dialogs";

const PAGE_SIZE = 10;

export interface VendorPOListRow {
  id: string;
  nomor_po: string;
  tanggal_po: string;
  vendor_name?: string | null;
  vendor_code?: string | null;
  status: string;
  total?: number;
  grand_total?: number;
}

type ListParams = { page?: number; limit?: number; status?: string; search?: string };
type ListResult = { data: VendorPOListRow[]; pagination: { total: number; total_pages: number } };

interface VendorPOListPageProps {
  useList: (params: ListParams) => UseQueryResult<ListResult>;
  routes: { purchasingPoInsert: string; purchasingPoDetail: (id: string) => string };
  description: string;
  sectionDescription: string;
}

/** Daftar PO ke vendor (produk & barang operasional): cari, filter status, paginasi. */
export function VendorPOListPage({ useList, routes, description, sectionDescription }: VendorPOListPageProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const listQuery = useList({
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const pos = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  // Debounce pencarian; halaman kembali ke 1 setiap kata kunci berubah.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const createButton = (
    <Link href={routes.purchasingPoInsert}>
      <Button className="purchasing-main-button w-full sm:w-auto">
        <Plus className="mr-2 h-4 w-4" />
        Buat Purchase Order
      </Button>
    </Link>
  );

  return (
    <div className="space-y-6">
      <PurchasingPageHeader title="Purchase Order" description={`${description}, ${total} total`} actions={createButton} />

      <PurchasingListSection
        icon={FileText}
        title="Daftar Purchase Order"
        description={sectionDescription}
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor PO atau vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              )}
            </label>
            <Button variant="outline" onClick={() => setFilterOpen((v) => !v)} className="h-10">
              <Filter className="mr-2 h-4 w-4" />
              Filter
            </Button>
          </div>
        }
      >
        {filterOpen && (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <Combobox
              options={VENDOR_PO_STATUS_OPTIONS}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              placeholder="Filter status..."
              className="h-9 text-sm md:max-w-xs"
            />
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Memuat purchase order...</div>
        ) : listQuery.isError ? (
          <div className="py-12 text-center text-sm text-red-600">Gagal memuat purchase order</div>
        ) : pos.length === 0 ? (
          <div className="py-14 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">Belum ada purchase order</p>
            <Link href={routes.purchasingPoInsert}>
              <Button variant="outline" className="mt-4 purchasing-secondary-button">
                Buat Purchase Order Pertama
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Nomor PO</th>
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pos.map((po) => (
                    <tr
                      key={po.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(routes.purchasingPoDetail(po.id))}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{po.nomor_po}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal_po)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{po.vendor_name || "-"}</div>
                        <div className="text-xs text-gray-500">{po.vendor_code || ""}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatRupiah(po.grand_total ?? po.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <ToneBadge tone={vendorPoStatusBadge(po.status)} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link href={routes.purchasingPoDetail(po.id)}>
                          <Button variant="ghost" size="sm" title="Lihat detail">
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
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </PurchasingListSection>
    </div>
  );
}
