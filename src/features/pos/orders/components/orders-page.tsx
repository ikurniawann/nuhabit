"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle,
  Clock,
  CreditCard,
  ExternalLink,
  Eye,
  Loader2,
  Merge,
  Printer,
  Search,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  printThermalReceipt,
} from "@/components/pos/PrintReceipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VoidModal } from "@/components/pos/VoidModal";
import { OwnerCompModal } from "@/components/pos/OwnerCompModal";
import { canVoidOrderStatus } from "@/lib/pos/void-order";
import {
  canOpenOrderInCashier,
  cashierHandoffFromOrderListRow,
  groupOrdersByCheckout,
} from "@/lib/pos/order-list-group";
import {
  cashierHomeFromOrders,
  posHomeFromOrders,
} from "@/features/pos/cashier/constants";
import { formatPaymentMethodLabel } from "@/features/pos/reports/utils/transaction-labels";
import { cn } from "@/lib/utils";

import type { Order, OrderListParams } from "../types";
import { checkoutFamilyToReceiptPayload, orderToReceiptPayload } from "../order-to-receipt";
import { useOrderList } from "../queries";
import { firstDayOfMonthWib, todayWib } from "@/lib/pos/report-dates";
import {
  TransactionDetailBody,
  type TransactionOrderDetail,
} from "@/features/pos/reports/components/transaction-detail-body";
import { loadOrderTransactionDetail } from "@/features/pos/reports/utils/load-order-detail";
import { orderCustomerLabel } from "@/lib/pos/order-customer";
import { SelfOrderBubble } from "@/features/pos/self-orders/components/self-order-bubble";
import {
  flattenOrderItems,
  mergeBillTransactionDetail,
  orderToTransactionRow,
} from "../order-transaction-detail";

const shiftWibDate = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const selectClassName =
  "flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(Number(value)) ? Math.abs(Number(value)) : 0);

const formatDate = (dateString: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));

/**
 * Badge status di LIST = status PEMBAYARAN, bukan status dapur (EPIC-041
 * task 6, keputusan owner): alur kasir membuat order lunas berstatus
 * fulfilment 'pending' (baru 'completed' setelah KDS men-serve semua item),
 * jadi badge "Pending" pada order lunas menyesatkan. Status dapur tetap
 * bisa dilihat di order detail ("Status dapur").
 */
function PaymentStatusBadge({ order, paid }: { order: Order; paid: boolean }) {
  const status = String(order.status || "");
  const map: Record<string, { label: string; className: string; icon: typeof Clock }> = {
    voided: { label: "Void", className: "bg-muted text-muted-foreground", icon: XCircle },
    cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700", icon: XCircle },
    merged: { label: "Merged", className: "bg-indigo-50 text-indigo-800", icon: Merge },
  };
  const meta =
    map[status] ??
    (paid
      ? { label: "Lunas", className: "bg-emerald-50 text-emerald-800", icon: CheckCircle }
      : { label: "Belum bayar", className: "bg-amber-50 text-amber-800", icon: Clock });
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("gap-1 font-medium", meta.className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

/** Order yang dapurnya masih jalan — apa pun status bayarnya. */
function isKitchenOpen(order: Order) {
  return ["pending", "preparing", "ready"].includes(String(order.status || ""));
}

function isPaid(order: Order) {
  return (
    (order.payment_status === "paid" || order.status === "completed") &&
    order.status !== "voided" &&
    order.status !== "cancelled"
  );
}

/** Belum bayar yang MASIH hidup — void/cancel/merged bukan "belum bayar". */
function isUnpaid(order: Order) {
  return (
    !isPaid(order) &&
    !["voided", "cancelled", "merged"].includes(String(order.status || ""))
  );
}

function TypeBadge({ type, prominent = false }: { type?: string | null; prominent?: boolean }) {
  const value = String(type || "");
  const labels: Record<string, string> = {
    dine_in: "Dine-in",
    takeaway: "Takeaway",
    delivery: "Delivery",
    self_order: "Self-order",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-gray-200/80 bg-white font-medium text-foreground",
        // Header "Order detail" (owner 2026-10-01): tipe harus langsung terlihat.
        prominent && "px-2.5 py-1 text-sm font-semibold",
        prominent && value === "dine_in" && "border-primary/30 bg-primary/10 text-primary",
        prominent && value === "takeaway" && "border-amber-300 bg-amber-50 text-amber-700",
        prominent && value === "delivery" && "border-emerald-300 bg-emerald-50 text-emerald-700"
      )}
    >
      {value === "delivery" ? <Truck className="mr-1 h-3 w-3" /> : null}
      {labels[value] || value || "—"}
    </Badge>
  );
}

function PaymentBadge({
  method,
  code,
  name,
}: {
  method?: string | null;
  code?: string | null;
  name?: string | null;
}) {
  const label = formatPaymentMethodLabel(method, { code, name });
  if (label === "—") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-gray-200/80 bg-white font-medium text-foreground"
    >
      <CreditCard className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function printOrderReceipt(order: Order, siblings: Order[] = []) {
  // Checkout multi-stall: cetak SEMUA anak-order (fix 2026-08-23) — dulu
  // hanya order yang diklik, item stall lain hilang dari struk reprint.
  const payload =
    siblings.length > 1
      ? checkoutFamilyToReceiptPayload(siblings)
      : orderToReceiptPayload(order);
  // Bill BELUM dibayar dicetak sebagai PREVIEW BILL (EPIC-043): memuat blok
  // tanda tangan "Disetujui/Nama" — arsip persetujuan Owner Comp untuk open
  // bill tanpa meja yang tidak lewat dialog Pre Settlement restaurant.
  const label = isUnpaid(order) ? "PREVIEW_BILL" : "CUSTOMER";
  void printThermalReceipt(payload, label);
}

// Filter berbasis pembayaran (EPIC-041 task 6). "kitchen_open" menggantikan
// pending/preparing/ready yang ambigu — untuk operasional yang ingin melihat
// order yang dapurnya belum selesai, terlepas dari status bayar.
const STATUS_FILTERS = [
  "all",
  "paid",
  "unpaid",
  "kitchen_open",
  "voided",
] as const;

/**
 * Keputusan owner 2026-08-23: TANPA batasan — semua order sesuai filter
 * dimuat (dulu 300 terbaru saja, membuat kartu "Semua" menyesatkan: tampil
 * 315 padahal bulan berjalan 771). Server memagari di 10.000 baris demi
 * keselamatan browser; rentang normal tidak akan menyentuhnya.
 */
const ORDER_LIST_LIMIT = 10_000;

type PeriodPreset = "today" | "7d" | "month";

function periodRange(preset: PeriodPreset) {
  const today = todayWib();
  if (preset === "today") return { date_from: today, date_to: today };
  if (preset === "7d") return { date_from: shiftWibDate(today, -6), date_to: today };
  return { date_from: firstDayOfMonthWib(), date_to: today };
}

export function OrdersPage() {
  const searchParams = useSearchParams();
  const posReturn = posHomeFromOrders(searchParams);
  // Default buka halaman = HARI INI (keputusan owner 2026-08-24); rentang
  // lain tinggal klik preset/filter.
  const initialPeriod = periodRange("today");
  const [dateFrom, setDateFrom] = useState(initialPeriod.date_from);
  const [dateTo, setDateTo] = useState(initialPeriod.date_to);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [applied, setApplied] = useState<OrderListParams>({
    date_from: initialPeriod.date_from,
    date_to: initialPeriod.date_to,
    limit: ORDER_LIST_LIMIT,
  });
  const { data: orders = [], isLoading, isFetching, isError, error, refetch } =
    useOrderList(applied);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedSiblings, setSelectedSiblings] = useState<Order[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fetchedDetail, setFetchedDetail] = useState<TransactionOrderDetail | null>(null);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showOwnerCompModal, setShowOwnerCompModal] = useState(false);

  useEffect(() => {
    if (!isError) return;
    toast.error(error instanceof Error ? error.message : "Gagal memuat orders");
  }, [isError, error]);

  function applyFilter(next?: {
    date_from?: string;
    date_to?: string;
    payment_status?: string;
    order_type?: string;
    payment_method?: string;
  }) {
    const from = next?.date_from ?? dateFrom;
    const to = next?.date_to ?? dateTo;
    if (from && to && from > to) {
      toast.error("Tanggal dari tidak boleh melebihi tanggal sampai");
      return;
    }
    if (next?.date_from) setDateFrom(next.date_from);
    if (next?.date_to) setDateTo(next.date_to);
    setApplied({
      date_from: from,
      date_to: to,
      payment_status: (next?.payment_status ?? paymentStatus) || undefined,
      order_type: (next?.order_type ?? orderType) || undefined,
      payment_method: (next?.payment_method ?? paymentMethod) || undefined,
      limit: ORDER_LIST_LIMIT,
    });
    setPage(1);
  }

  const statusCounts = useMemo(
    () => ({
      all: orders.length,
      paid: orders.filter((o) => isPaid(o)).length,
      unpaid: orders.filter((o) => isUnpaid(o)).length,
      kitchen_open: orders.filter((o) => isKitchenOpen(o)).length,
      voided: orders.filter((o) => o.status === "voided").length,
    }),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch =
        !q ||
        order.order_number?.toLowerCase().includes(q) ||
        order.checkout_number?.toLowerCase().includes(q) ||
        order.queue_number?.toLowerCase().includes(q) ||
        order.customer?.name?.toLowerCase().includes(q) ||
        order.cashier_id?.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "paid" && isPaid(order)) ||
        (statusFilter === "unpaid" && isUnpaid(order)) ||
        (statusFilter === "kitchen_open" && isKitchenOpen(order)) ||
        (statusFilter === "voided" && order.status === "voided");
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchTerm, statusFilter]);

  const groupedOrders = useMemo(
    () => groupOrdersByCheckout(filteredOrders),
    [filteredOrders]
  );

  /* Pagination tabel (owner 2026-08-24): semua data periode tetap dimuat
   * (kartu status menghitung dari total sebenarnya), tabel dipotong per
   * halaman supaya rentang panjang tetap ringan digulir. */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageCount = Math.max(1, Math.ceil(groupedOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedOrders = useMemo(
    () => groupedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [groupedOrders, currentPage, pageSize]
  );

  const openDetail = (order: Order, siblings: Order[] = []) => {
    setSelectedOrder(order);
    setSelectedSiblings(siblings.length > 1 ? siblings : []);
    setShowDetailModal(true);
    setFetchedDetail(null);
    setDetailLoading(true);
    void loadOrderTransactionDetail(order.id, order.checkout_id)
      .then((detail) => setFetchedDetail(detail))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Gagal memuat detail");
      })
      .finally(() => setDetailLoading(false));
  };

  const canVoid = (order: Order) => canVoidOrderStatus(order.status);

  return (
    <div className="space-y-4">
      <SelfOrderBubble />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Riwayat order per periode. Void order lunas lewat ikon Ban.
          </p>
        </div>
        {posReturn ? (
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={() => window.location.assign(posReturn.href)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {posReturn.label}
          </Button>
        ) : null}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["today", "Hari ini"],
                ["7d", "7 hari"],
                ["month", "Bulan ini"],
              ] as const
            ).map(([key, label]) => {
              const range = periodRange(key);
              const active =
                dateFrom === range.date_from && dateTo === range.date_to;
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "border-gray-200/80",
                    active && "border-primary/40 bg-primary/5 text-primary"
                  )}
                  disabled={isFetching}
                  onClick={() => applyFilter(range)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="orders-date-from">Tanggal dari</Label>
              <Input
                id="orders-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-date-to">Tanggal sampai</Label>
              <Input
                id="orders-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-payment-status">Pembayaran</Label>
              <select
                id="orders-payment-status"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="paid">Lunas</option>
                <option value="unpaid">Belum bayar</option>
                <option value="refunded">Refund</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-type">Tipe order</Label>
              <select
                id="orders-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="dine_in">Dine-in</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-method">Metode bayar</Label>
              <select
                id="orders-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="cash">Tunai</option>
                <option value="qris">QRIS</option>
                <option value="credit">Kartu</option>
                <option value="ark_coin">ARK Coin</option>
                <option value="gift_card">Gift card</option>
                <option value="nfc_tab">NFC Tab</option>
              </select>
            </div>
            <div className="flex items-end xl:col-start-4">
              <Button
                type="button"
                onClick={() => applyFilter()}
                disabled={isFetching}
                className="w-full gap-2"
              >
                {isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
                Terapkan filter
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(
          [
            ["all", "Semua", statusCounts.all, "text-foreground"],
            ["paid", "Lunas", statusCounts.paid, "text-emerald-700"],
            ["unpaid", "Belum bayar", statusCounts.unpaid, "text-amber-700"],
            ["kitchen_open", "Dapur belum selesai", statusCounts.kitchen_open, "text-sky-700"],
            ["voided", "Void", statusCounts.voided, "text-muted-foreground"],
          ] as const
        ).map(([key, label, count, tone]) => (
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
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>
              {count}
            </div>
          </button>
        ))}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
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
              {applied.date_from && applied.date_to
                ? ` · ${applied.date_from} s/d ${applied.date_to}`
                : ""}
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
            <div className="overflow-x-auto rounded-xl border border-gray-200/70">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Order / Antrian</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Items</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="w-px whitespace-nowrap px-3 py-3 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrders.map((row) => {
                    const order = row.kind === "single" ? row.order : row.orders[0];
                    if (!order) return null;
                    const isMixed = row.kind === "checkout";
                    const displayNumber = isMixed ? row.checkoutNumber : order.order_number;
                    const total = isMixed ? row.total : order.total_amount || 0;
                    const itemCount = isMixed
                      ? row.orders.reduce((sum, child) => sum + (child.items?.length || 0), 0)
                      : order.items?.length || 0;
                    const paid = isMixed ? row.paid : isPaid(order);
                    return (
                    <tr
                      key={isMixed ? row.checkoutId : order.id}
                      className="border-b border-gray-200/70 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                        <div>{displayNumber}</div>
                        {isMixed && row.orders.length > 1 ? (
                          <div className="mt-0.5 space-y-0.5 font-sans text-[11px] font-medium text-primary">
                            <div>Gabungan {row.orders.length} stall</div>
                            <div className="font-mono font-normal text-muted-foreground">
                              {row.orders
                                .map((child) => child.order_number)
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        ) : order.queue_number ? (
                          <div className="mt-0.5 text-[11px] font-bold text-primary">
                            Antrian {order.queue_number}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {order.ordered_at ? formatDate(order.ordered_at) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">
                            {orderCustomerLabel(order)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge type={order.order_type} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {itemCount}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentBadge
                          method={order.payment_method}
                          code={order.payment_method_code}
                          name={order.payment_method_name}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {formatCurrency(total)}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge order={order} paid={paid} />
                      </td>
                      <td
                        className="w-px whitespace-nowrap px-3 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1">
                          {canOpenOrderInCashier(isMixed ? row.orders : [order]) ? (
                            <Button
                              type="button"
                              size="icon"
                              className="h-8 w-8 bg-primary hover:bg-primary/90"
                              title="Open in cashier"
                              onClick={() => {
                                const handoff = cashierHandoffFromOrderListRow(row);
                                const url = new URL(
                                  cashierHomeFromOrders(searchParams),
                                  "http://local.invalid"
                                );
                                if (handoff.checkoutId) {
                                  url.searchParams.set("checkoutId", handoff.checkoutId);
                                } else if (handoff.orderId) {
                                  url.searchParams.set("orderId", handoff.orderId);
                                }
                                window.location.assign(`${url.pathname}${url.search}`);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-gray-200/80"
                            title="Detail"
                            onClick={() =>
                              openDetail(
                                order,
                                isMixed ? row.orders : []
                              )
                            }
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {canVoid(order) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 border-red-200/80 text-red-700 hover:bg-red-50"
                              title="Void order"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowVoidModal(true);
                              }}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {groupedOrders.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/70 pt-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Baris per halaman</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-8 rounded-md border border-gray-200/80 bg-white px-2 text-sm"
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <span>
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, groupedOrders.length)} dari{" "}
                  {groupedOrders.length} tagihan
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Sebelumnya
                </Button>
                <span className="text-sm text-muted-foreground">
                  Hal {currentPage} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={showDetailModal}
        onOpenChange={(open) => {
          setShowDetailModal(open);
          if (!open) {
            setSelectedOrder(null);
            setSelectedSiblings([]);
            setFetchedDetail(null);
          }
        }}
      >
        <DialogPanel size="xl">
          <DialogPanelHeader>
            <DialogPanelTitle className="flex flex-wrap items-center gap-2">
              {selectedSiblings.length > 1
                ? selectedOrder?.checkout_number || "Tagihan gabungan"
                : "Order detail"}
              {selectedOrder?.order_type ? (
                <TypeBadge type={selectedOrder.order_type} prominent />
              ) : null}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {selectedSiblings.length > 1
                ? selectedSiblings
                    .map((child) => child.order_number)
                    .filter(Boolean)
                    .join(" · ")
                : selectedOrder?.order_number || "Order"}
              {selectedOrder?.ordered_at
                ? ` · ${formatDate(selectedOrder.ordered_at)}`
                : ""}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            {detailLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : selectedOrder ? (
              <OrderDetail
                order={selectedOrder}
                siblings={selectedSiblings}
                detail={fetchedDetail}
              />
            ) : null}
          </DialogPanelBody>
          <DialogFooter>
            {selectedOrder && canVoid(selectedOrder) ? (
              <Button
                type="button"
                variant="outline"
                className="border-red-200/80 text-red-700 hover:bg-red-50"
                onClick={() => {
                  setShowDetailModal(false);
                  setShowVoidModal(true);
                }}
              >
                <Ban className="mr-2 h-4 w-4" />
                Void
              </Button>
            ) : null}
            {selectedOrder && isUnpaid(selectedOrder) ? (
              <Button
                type="button"
                variant="outline"
                className="border-gray-200/80"
                onClick={() => {
                  setShowDetailModal(false);
                  setShowOwnerCompModal(true);
                }}
              >
                Owner Comp
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => {
                if (!selectedOrder) return;
                printOrderReceipt(selectedOrder, selectedSiblings);
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print receipt
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowDetailModal(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <OwnerCompModal
        open={showOwnerCompModal}
        order={selectedOrder}
        siblings={selectedSiblings}
        onClose={() => setShowOwnerCompModal(false)}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
          setSelectedSiblings([]);
        }}
      />

      <VoidModal
        open={showVoidModal}
        order={selectedOrder}
        siblings={selectedSiblings}
        onClose={() => {
          setShowVoidModal(false);
          setSelectedOrder(null);
          setSelectedSiblings([]);
        }}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
          setSelectedSiblings([]);
        }}
      />
    </div>
  );
}

function OrderDetail({
  order,
  siblings = [],
  detail,
}: {
  order: Order;
  siblings?: Order[];
  detail: TransactionOrderDetail | null;
}) {
  const childOrders = siblings.length > 1 ? siblings : [order];
  const merged = mergeBillTransactionDetail(detail, childOrders);
  const items =
    childOrders.length > 1
      ? flattenOrderItems(childOrders)
      : flattenOrderItems([
          {
            ...order,
            items: detail?.items || order.items,
          },
        ]);

  return (
    <div className="space-y-4">
      {childOrders.length > 1 ? (
        <section className="rounded-lg border border-gray-200/70 bg-card">
          <h3 className="border-b border-gray-200/70 px-3 py-2 text-sm font-semibold text-foreground">
            Nomor POS per stall
          </h3>
          <div className="space-y-2 p-3">
            {childOrders.map((child) => (
              <div
                key={child.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {child.order_number || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(() => {
                      const stall = (child as { stall_name?: string | null }).stall_name;
                      const count = `${child.items?.length || 0} item`;
                      return stall ? `${stall} · ${count}` : count;
                    })()}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(child.total_amount || 0)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <TransactionDetailBody
        row={orderToTransactionRow(order)}
        detail={merged}
        items={items}
      />
    </div>
  );
}
