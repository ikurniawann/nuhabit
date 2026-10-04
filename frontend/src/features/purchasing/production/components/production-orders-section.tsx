"use client";

import Link from "next/link";
import { CheckCircle2, ClipboardList, Eye, Loader2, PackageCheck, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { formatNumber } from "@/lib/format";
import {
  displayName,
  paginate,
  productionStatusClass,
  productionStatusLabel,
  toNumber,
} from "@/lib/purchasing/production-ui-display";
import type { useProductionOrderActions } from "../hooks/use-production-order-actions";
import type { ProductionOrder } from "../types";

const PAGE_SIZE = 10;

type ProductionOrdersSectionProps = {
  isProduct: boolean;
  orders: ProductionOrder[];
  loading: boolean;
  page: number;
  onPageChange: (page: number) => void;
  orderRoute: (id: string) => string;
  pending: ReturnType<typeof useProductionOrderActions>["pending"];
  onAdvance: (orderId: string, action: "release" | "start") => void;
  onReceive: (order: ProductionOrder) => void;
};

export function ProductionOrdersSection({
  isProduct,
  orders,
  loading,
  page,
  onPageChange,
  orderRoute,
  pending,
  onAdvance,
  onReceive,
}: ProductionOrdersSectionProps) {
  const { rows, totalPages } = paginate(orders, page, PAGE_SIZE);

  return (
    <PurchasingListSection
      icon={ClipboardList}
      title="Order Produksi Aktif"
      description="Order baru dimulai sebagai Draf. Dirilis untuk reservasi bahan, Mulai untuk memulai produksi, dan Terima untuk memposting output ke inventori."
      toolbar={
        <Badge variant="outline" className="border-gray-200/80 bg-gray-50 text-gray-600">
          {orders.length} order
        </Badge>
      }
    >
      <div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Nomor Produksi</th>
                <th className="px-4 py-3 text-left font-semibold">{isProduct ? "Produk" : "Bahan Baku"}</th>
                <th className="px-4 py-3 text-right font-semibold">Kuantitas</th>
                <th className="px-4 py-3 text-right font-semibold">Biaya Bahan</th>
                <th className="px-4 py-3 text-right font-semibold">HPP / Unit</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Memuat order produksi...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Belum ada order produksi.
                  </td>
                </tr>
              ) : (
                rows.map((order) => {
                  const rowPending = pending?.id === order.id ? pending.type : null;
                  const busy = rowPending !== null || pending?.type === "receive";
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={orderRoute(order.id)} className="font-medium text-pink-700 hover:underline">
                          {order.nomor_produksi}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline" className={productionStatusClass(order.status)}>
                            {productionStatusLabel(order.status)}
                          </Badge>
                          {order.output_type === "WIP" && (
                            <Badge variant="outline" className="border-sky-200/80 bg-sky-50 text-sky-700">
                              WIP
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {displayName(order.item_nama || order.product_nama || order.output_raw_material_nama)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatNumber(toNumber(order.actual_qty) || toNumber(order.planned_qty), 3)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatNumber(order.actual_material_cost || order.planned_material_cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-pink-700">
                        {formatNumber(order.hpp_per_unit)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={orderRoute(order.id)}>
                            <Button variant="ghost" size="sm" title="Lihat detail order" className="cursor-pointer">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {order.status === "DRAFT" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Dirilis order"
                              disabled={busy}
                              onClick={() => onAdvance(order.id, "release")}
                              className="h-8 gap-1.5 border-amber-200/80 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            >
                              {rowPending === "release" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Dirilis
                            </Button>
                          )}
                          {order.status === "RELEASED" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Mulai produksi"
                              disabled={busy}
                              onClick={() => onAdvance(order.id, "start")}
                              className="h-8 gap-1.5 border-sky-200/80 px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
                            >
                              {rowPending === "start" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              Mulai
                            </Button>
                          )}
                          {order.status === "IN_PROGRESS" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Terima output ke inventori"
                              disabled={busy}
                              onClick={() => onReceive(order)}
                              className="h-8 gap-1.5 border-pink-200/80 px-2.5 text-xs font-medium text-pink-700 hover:bg-pink-50"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              Terima
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && orders.length > 0 && (
          <PurchasingTablePagination
            page={page}
            totalPages={totalPages}
            totalItems={orders.length}
            pageSize={PAGE_SIZE}
            onPageChange={onPageChange}
          />
        )}
      </div>
    </PurchasingListSection>
  );
}
