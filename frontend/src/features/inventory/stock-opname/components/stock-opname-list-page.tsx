"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  ClipboardDocumentListIcon,
  EyeIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { useStockOpnameList } from "../queries";
import {
  STOCK_OPNAME_STATUS_COLORS,
  STOCK_OPNAME_STATUS_LABELS,
  type StockOpnameStatus,
} from "../types";
import { formatDate, formatNumber } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draf" },
  { value: "in_progress", label: "Perhitungan Berjalan" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

export function StockOpnameListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockOpnameStatus | "all">(
    "all",
  );
  const limit = 20;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const listQuery = useStockOpnameList({
    page,
    limit,
    status: statusFilter,
    search: search || undefined,
    reason: "stock_opname",
  });

  const items = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Stok Opname"
        description={`Hitung stok fisik bahan baku dan rekonsiliasi selisih — ${total} sesi`}
        actions={
          <>
            <Link href={RM_ROUTES.inventoryOpnameInsert}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <PlusIcon className="mr-2 h-4 w-4" />
                Buat Stok Opname
              </Button>
            </Link>
            <Link href={RM_ROUTES.inventoryStock}>
              <Button
                variant="outline"
                className="purchasing-secondary-button w-full sm:w-auto"
              >
                Lihat Stok
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Sesi</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">
              Perhitungan Berjalan
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {items.filter((item) => item.status === "in_progress").length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Selesai</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">
              {items.filter((item) => item.status === "completed").length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Draf</p>
            <p className="mt-1 text-2xl font-bold text-gray-700">
              {items.filter((item) => item.status === "draft").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={ClipboardDocumentListIcon}
        title="Daftar Stok Opname"
        description="Sesi perhitungan stok fisik per stall"
        toolbar={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex-1 lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nomor opname..."
                className="h-10 border-gray-200/80 pl-9"
              />
            </label>
            <Combobox
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value as StockOpnameStatus | "all");
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Status"
              className="h-10 w-full lg:w-48"
            />
            <Button
              variant="outline"
              className="h-10 border-gray-200/80"
              onClick={() => listQuery.refetch()}
              disabled={loading}
            >
              <ArrowPathIcon
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Muat Ulang
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto px-4">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">Nomor</th>
                <th className="px-3 py-3">Tanggal</th>
                <th className="px-3 py-3">Stall</th>
                <th className="px-3 py-3 text-right">Baris</th>
                <th className="px-3 py-3 text-right">Terhitung</th>
                <th className="px-3 py-3 text-right">Selisih</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-12 text-center text-gray-400"
                  >
                    Memuat sesi stok opname...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-12 text-center text-gray-400"
                  >
                    <ClipboardDocumentListIcon className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    Belum ada sesi stok opname
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200/70 transition-colors hover:bg-gray-50/80"
                  >
                    <td className="px-3 py-3 font-semibold text-gray-950">
                      {item.opname_number}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {formatDate(item.opname_date)}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {item.warehouse?.name || "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatNumber(item.total_lines, 4)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatNumber(item.lines_counted, 4)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatNumber(item.lines_with_variance, 4)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={STOCK_OPNAME_STATUS_COLORS[item.status]}
                      >
                        {STOCK_OPNAME_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {item.status === "draft" ||
                      item.status === "in_progress" ? (
                        <Link href={RM_ROUTES.inventoryOpnameContinue(item.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-pink-700"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                            Lanjutkan
                          </Button>
                        </Link>
                      ) : (
                        <Link href={RM_ROUTES.inventoryOpnameDetail(item.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-pink-700"
                          >
                            <EyeIcon className="h-4 w-4" />
                            Detail
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
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
      </PurchasingListSection>
    </div>
  );
}
