"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, ReceiptText, Table2 } from "lucide-react";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import type { Order } from "@/features/pos/open-bills/types";
import { cn } from "@/lib/utils";
import type { PosTable } from "@/lib/pos-api";

import { buildCashierHandoffUrl } from "../nav";
import { getActiveSplitSummary } from "@/features/pos/open-bills/split-summary";
import { PaymentProofBadge } from "@/features/pos/open-bills/payment-proof-badge";
import {
  cashierHandoffFromBill,
  listTableBoardBills,
  tableBillSourceLabel,
  type TableBoardBill,
} from "@/lib/pos/tables/table-board-bills";
import {
  billSelection,
  isBillSelected,
  type NullableRestaurantSelection,
  type RestaurantSelection,
} from "../selection";
import { formatRupiah } from "@/lib/format";

const formatCurrency = (value: number) => formatRupiah(Math.abs(Number(value) || 0));

function formatRelativeTime(value?: string) {
  if (!value) return "-";

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "-";

  const diffMinutes = Math.round((time - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  return formatter.format(Math.round(diffHours / 24), "day");
}

const subscribeMinute = (onTick: () => void) => {
  const timer = window.setInterval(onTick, 60_000);
  return () => window.clearInterval(timer);
};

/** "-" saat SSR supaya Date.now() server/klien tidak bentrok saat hidrasi; diperbarui per menit. */
function RelativeTime({ value }: { value?: string }) {
  const label = useSyncExternalStore(subscribeMinute, () => formatRelativeTime(value), () => "-");
  return <span suppressHydrationWarning>{label}</span>;
}

function getTableDisplayName(table?: PosTable) {
  return table?.label || table?.table_number || table?.name || null;
}

function resolveOrderTableLabel(order: Order, tablesById: Map<string, PosTable>) {
  if (order.table_id) {
    const tableName = getTableDisplayName(tablesById.get(order.table_id));
    if (tableName) return tableName;
  }

  if (order.table?.table_number) return order.table.table_number;
  if (order.table?.qr_code) return order.table.qr_code;
  return order.table_id ? "Meja" : "Without table";
}

export interface RestaurantBillsRailProps {
  tablesById: Map<string, PosTable>;
  selection: NullableRestaurantSelection;
  immersive?: boolean;
  /** When set, only bills for this table are listed (board detail). */
  filterTableId?: string | null;
  /** panel = permanent column (legacy); drawer = content inside Sheet */
  variant?: "panel" | "drawer";
  onSelect: (selection: RestaurantSelection) => void;
  onPaySplits?: (order: Order) => void;
}

export function RestaurantBillsRail({
  tablesById,
  selection,
  immersive = false,
  filterTableId = null,
  variant = "panel",
  onSelect,
  onPaySplits,
}: RestaurantBillsRailProps) {
  const router = useRouter();
  const { data: orders = [], isLoading, error } = useOpenBills({
    limit: 200,
  });

  const checkouts = useMemo(
    () =>
      [...tablesById.values()].flatMap((table) =>
        (table.open_checkouts || []).map((checkout) => ({
          id: checkout.id,
          table_id: table.id,
          payment_status: checkout.payment_status,
          checkout_number: checkout.checkout_number,
          total_amount: checkout.total_amount,
        }))
      ),
    [tablesById]
  );

  const bills = useMemo(
    () =>
      listTableBoardBills({
        tableId: filterTableId,
        orders,
        checkouts,
      }),
    [checkouts, filterTableId, orders]
  );
  const ordersById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders]
  );
  const loading = isLoading;
  const errorMessage = error instanceof Error ? error.message : null;

  const openBill = (bill: TableBoardBill) => {
    const order = bill.orderId ? ordersById.get(bill.orderId) : null;
    const splitSummary = order ? getActiveSplitSummary(order.splits) : null;
    if (order && splitSummary && onPaySplits) {
      onPaySplits(order);
      return;
    }
    const handoff = cashierHandoffFromBill(bill);
    if (!handoff.checkoutId && !handoff.orderId) {
      toast.error("Checkout ini belum punya order anak untuk dibuka di kasir");
      return;
    }
    router.push(
      buildCashierHandoffUrl({
        checkoutId: handoff.checkoutId,
        orderId: handoff.orderId,
        tableId: bill.table_id ?? undefined,
        immersive,
      })
    );
  };

  const filterTable = filterTableId ? tablesById.get(filterTableId) : null;
  const header = (
    <div className={cn(variant === "drawer" ? "pr-10" : undefined)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-950">Open Bills</h2>
          <p className="text-xs text-muted-foreground">
            {filterTable
              ? `Semua tagihan di ${getTableDisplayName(filterTable) || "meja ini"}.`
              : "Select a bill to use restaurant actions."}
          </p>
        </div>
        <Badge variant="outline" className="border-primary/20 text-brand-text">
          {bills.length}
        </Badge>
      </div>
    </div>
  );

  const body = (
    <div
      className={cn(
        "min-h-0 flex-1 space-y-3 overflow-y-auto",
        variant === "drawer" ? "p-4 pt-0" : "p-3",
        variant === "panel" && "min-h-[220px]"
      )}
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading open bills...
        </div>
      ) : errorMessage ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
          {errorMessage}
        </div>
      ) : bills.length === 0 ? (
        <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-6 text-center">
          <ReceiptText className="mx-auto size-8 text-muted-foreground" />
          <div className="mt-3 text-sm font-semibold text-gray-950">
            No open bills
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Active restaurant bills will appear here.
          </p>
        </div>
      ) : (
        bills.map((bill) => {
          const order = bill.orderId ? ordersById.get(bill.orderId) : null;
          const selected = Boolean(
            (bill.orderId && isBillSelected(selection, bill.orderId)) ||
              (selection?.orderId &&
                order &&
                isBillSelected(selection, order.id))
          );
          const tableLabel = bill.table_id
            ? getTableDisplayName(tablesById.get(bill.table_id)) ||
              (order ? resolveOrderTableLabel(order, tablesById) : "Meja")
            : "Without table";
          const splitSummary = order ? getActiveSplitSummary(order.splits) : null;

          return (
            <article
              key={`${bill.kind}-${bill.id}`}
              role="button"
              tabIndex={0}
              onClick={() =>
                onSelect(
                  billSelection(bill.orderId || bill.id, bill.table_id ?? undefined)
                )
              }
              onDoubleClick={() => openBill(bill)}
              onKeyDown={(event) => {
                if (event.key === "Enter") openBill(bill);
              }}
              className={cn(
                "rounded-lg border bg-white p-3 text-left shadow-xs transition-all",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                  : "border-gray-200/70 hover:border-primary/30 hover:bg-primary/5"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-bold text-gray-950">
                    {bill.label}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Table2 className="size-3.5" />
                    <span className="truncate">{tableLabel}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="mt-2 border-gray-200/80 bg-gray-50 text-[10px] text-muted-foreground"
                  >
                    {tableBillSourceLabel(bill.soldFrom)}
                  </Badge>
                  {splitSummary ? (
                    <Badge
                      variant="outline"
                      className="mt-2 ml-1 border-primary/20 bg-primary/5 text-[10px] text-brand-text"
                    >
                      Split · {splitSummary.paid}/{splitSummary.total}
                    </Badge>
                  ) : null}
                  <PaymentProofBadge order={order} />
                </div>
                <div className="shrink-0 text-right text-sm font-bold text-gray-950">
                  {formatCurrency(bill.total_amount)}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  <RelativeTime value={order?.ordered_at} />
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-primary/20 px-2 text-xs text-brand-text hover:bg-primary/5"
                  onClick={(event) => {
                    event.stopPropagation();
                    openBill(bill);
                  }}
                >
                  {splitSummary ? "Pay" : "Open"}
                </Button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );

  if (variant === "drawer") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-gray-200/70 px-4 py-3">{header}</div>
        {body}
      </div>
    );
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col rounded-xl border border-gray-200/70 bg-white shadow-xs min-[800px]:h-full">
      <div className="border-b border-gray-200/70 px-4 py-3">{header}</div>
      {body}
    </aside>
  );
}
