"use client";

import { useState } from "react";
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useStockTransferList } from "../queries";
import { STOCK_TRANSFER_KIND_LABELS } from "../types";

const LIMIT = 20;

/** Riwayat transfer stok (paginasi sendiri; disegarkan lewat invalidasi query transfer). */
export function TransferHistorySection() {
  const [page, setPage] = useState(1);
  const listQuery = useStockTransferList({ page, limit: LIMIT });
  const historyItems = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  return (
    <PurchasingListSection
      icon={ArrowsRightLeftIcon}
      title="Riwayat Transfer"
      description={`${total} data transfer`}
      toolbar={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="purchasing-secondary-button"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          <ArrowPathIcon
            className={`mr-2 h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`}
          />
          Muat Ulang
        </Button>
      }
    >
      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-3 py-3">No. Transfer</th>
              <th className="px-3 py-3">Tanggal</th>
              <th className="px-3 py-3">Jenis</th>
              <th className="px-3 py-3">Bahan Baku</th>
              <th className="px-3 py-3 text-right">Qty</th>
              <th className="px-3 py-3">Stall Asal</th>
              <th className="px-3 py-3">Stall Tujuan</th>
              <th className="px-3 py-3">Dibuat Oleh</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-gray-400"
                >
                  Memuat riwayat transfer...
                </td>
              </tr>
            ) : historyItems.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-gray-400"
                >
                  Belum ada transfer yang tercatat
                </td>
              </tr>
            ) : (
              historyItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-200/70 transition-colors hover:bg-gray-50/60"
                >
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">
                    {item.transfer_number}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {formatDateTime(item.created_at)}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {item.transfer_kind
                      ? STOCK_TRANSFER_KIND_LABELS[item.transfer_kind]
                      : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-gray-900">
                      {item.material_nama}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.material_kode}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-gray-900">
                    {formatNumber(item.qty, 4)}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {item.source_warehouse_name}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {item.dest_warehouse_name}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {item.created_by_name || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="border-t border-gray-200/70 px-4 py-4">
          <PurchasingTablePagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={LIMIT}
            onPageChange={setPage}
          />
        </div>
      )}
    </PurchasingListSection>
  );
}
