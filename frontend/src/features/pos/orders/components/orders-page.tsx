"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OwnerCompModal } from "@/components/pos/OwnerCompModal";
import { VoidModal } from "@/components/pos/VoidModal";
import { cashierHomeFromOrders, posHomeFromOrders } from "@/features/pos/cashier/constants";
import { SelfOrderBubble } from "@/features/pos/self-orders/components/self-order-bubble";
import { cashierHandoffFromOrderListRow, groupOrdersByCheckout } from "@/lib/pos/order-list-group";
import { cn } from "@/lib/utils";
import {
  cashierHandoffUrl,
  countByStatus,
  filterOrders,
  paginate,
  periodRange,
  STATUS_FILTERS,
  toOrderListParams,
  type OrderFilterDraft,
  type StatusFilter,
} from "../order-list-rules";
import { useOrderList } from "../queries";
import type { Order, OrderListParams } from "../types";
import { OrderDetailDialog } from "./order-detail-dialog";
import { OrdersFilterCard } from "./orders-filter-card";
import { OrdersTable } from "./orders-table";
import { OrdersPagination } from "./orders-pagination";

type Selection = { order: Order; siblings: Order[]; mode: "detail" | "void" | "comp" };

function initialDraft(): OrderFilterDraft {
  // Default buka halaman = HARI INI (keputusan owner 2026-08-24).
  return { ...periodRange("today"), payment_status: "", order_type: "", payment_method: "" };
}

export function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const posReturn = posHomeFromOrders(searchParams);
  const [draft, setDraft] = useState(initialDraft);
  const [applied, setApplied] = useState<OrderListParams>(() => {
    const result = toOrderListParams(initialDraft());
    return result.ok ? result.params : {};
  });
  const { data: orders = [], isLoading, isFetching, isError, error, refetch } = useOrderList(applied);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selection, setSelection] = useState<Selection | null>(null);
  /* Pagination tabel (owner 2026-08-24): semua data periode tetap dimuat
   * (kartu status menghitung dari total sebenarnya), tabel dipotong per halaman. */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (isError) toast.error(error instanceof Error ? error.message : "Gagal memuat orders");
  }, [isError, error]);

  const statusCounts = useMemo(() => countByStatus(orders), [orders]);
  const filteredOrders = useMemo(() => filterOrders(orders, searchTerm, statusFilter), [orders, searchTerm, statusFilter]);
  const groupedOrders = useMemo(() => groupOrdersByCheckout(filteredOrders), [filteredOrders]);
  const paged = paginate(groupedOrders, page, pageSize);

  function applyFilter(patch?: Partial<OrderFilterDraft>) {
    const next = { ...draft, ...patch };
    const result = toOrderListParams(next);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDraft(next);
    setApplied(result.params);
    setPage(1);
  }

  const select = (order: Order, siblings: Order[], mode: Selection["mode"]) =>
    setSelection({ order, siblings: siblings.length > 1 ? siblings : [], mode });
  const switchMode = (mode: Selection["mode"]) => setSelection((prev) => (prev ? { ...prev, mode } : prev));
  const afterAction = () => {
    void refetch();
    setSelection(null);
  };

  return (
    <div className="space-y-4">
      <SelfOrderBubble />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground">Riwayat order per periode. Void order lunas lewat ikon Ban.</p>
        </div>
        {posReturn ? (
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-brand-text"
            onClick={() => router.push(posReturn.href)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {posReturn.label}
          </Button>
        ) : null}
      </div>

      <OrdersFilterCard
        draft={draft}
        fetching={isFetching}
        onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        onApply={applyFilter}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STATUS_FILTERS.map(({ key, label, tone }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStatusFilter(key);
              setPage(1);
            }}
            className={cn(
              "rounded-xl border bg-white p-3.5 text-left shadow-xs transition-colors",
              statusFilter === key
                ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                : "border-gray-200/70 hover:border-primary/30 hover:bg-primary/5"
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{statusCounts[key]}</div>
          </button>
        ))}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Cari order"
                placeholder="Cari nomor order, checkout, antrian, atau pelanggan…"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="h-10 border-gray-200/80 bg-white pl-10"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {groupedOrders.length} tagihan · {filteredOrders.length} order
              {applied.date_from && applied.date_to ? ` · ${applied.date_from} s/d ${applied.date_to}` : ""}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading orders…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200/80 bg-muted/20 px-4 py-16 text-center text-sm text-muted-foreground">
              Tidak ada order pada filter ini. Coba ubah periode atau kata kunci.
            </div>
          ) : (
            <OrdersTable
              rows={paged.rows}
              onOpenInCashier={(row) =>
                router.push(cashierHandoffUrl(cashierHomeFromOrders(searchParams), cashierHandoffFromOrderListRow(row)))
              }
              onDetail={(order, siblings) => select(order, siblings, "detail")}
              onVoid={(order) => select(order, [], "void")}
            />
          )}

          {groupedOrders.length > 0 ? (
            <OrdersPagination
              total={groupedOrders.length}
              paged={paged}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <OrderDetailDialog
        order={selection?.mode === "detail" ? selection.order : null}
        siblings={selection?.siblings ?? []}
        onClose={() => setSelection(null)}
        onVoid={() => switchMode("void")}
        onOwnerComp={() => switchMode("comp")}
      />

      <OwnerCompModal
        open={selection?.mode === "comp"}
        order={selection?.order ?? null}
        siblings={selection?.siblings ?? []}
        onClose={() => setSelection(null)}
        onSuccess={afterAction}
      />

      <VoidModal
        open={selection?.mode === "void"}
        order={selection?.order ?? null}
        siblings={selection?.siblings ?? []}
        onClose={() => setSelection(null)}
        onSuccess={afterAction}
      />
    </div>
  );
}
