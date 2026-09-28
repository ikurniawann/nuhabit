"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buildPosOrdersUrl } from "@/features/pos/cashier/constants";
import { cashierQueryKeys } from "@/features/pos/cashier/query-keys";
import { useCashierTables } from "@/features/pos/cashier/queries";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import { openBillsQueryKeys } from "@/features/pos/open-bills/query-keys";
import { useCreateOrderSplits } from "@/features/pos/open-bills/mutations";
import type { Order } from "@/features/pos/open-bills/types";
import { SplitBillModal, type SplitConfig } from "@/components/pos/SplitBillModal";
import { SplitPaymentScreen } from "@/components/pos/SplitPaymentScreen";
import {
  mergeOrders,
  moveOrderTable,
  transferOrderItems,
  type PosTable,
} from "@/lib/pos-api";
import { cn } from "@/lib/utils";
import { PosTabletChromeControls } from "@/features/pos/components/pos-tablet-chrome-controls";
import { useHandheldClient } from "@/features/pos/use-handheld-client";

import { MoveItemsDialog, type MoveItemsSelection } from "./move-items-dialog";
import { RestaurantActionRail } from "./restaurant-action-rail";
import { RestaurantBillsRail } from "./restaurant-bills-rail";
import {
  RestaurantTableBoard,
  type RestaurantBoardMode,
} from "./restaurant-table-board";
import { WaitingListDialog } from "./waiting-list-dialog";
import {
  isRestaurantImmersive,
  isRestaurantTabletPath,
  restaurantPath,
  shouldUseTabletCashierHandoff,
} from "../nav";
import { restaurantWorkspaceClass } from "../restaurant-workspace-layout";
import {
  isTableSelected,
  tableSelection,
  type NullableRestaurantSelection,
  type RestaurantSelection,
} from "../selection";
import { canPickSeatDestination } from "../move-destination";
import { listTableBoardBills } from "../table-board-bills";
import {
  canAppendTransferItems,
  canMergeIntoDestination,
} from "@/lib/pos/table-sale-target";
import { useReservationList } from "@/features/pos/reservation/queries";
import { reservationQueryKeys } from "@/features/pos/reservation/query-keys";
import { seatReservation } from "@/features/pos/reservation/api";
import type { ReservationRow } from "@/features/pos/reservation/types";
import { orderCustomerName } from "@/lib/pos/order-customer";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(Number(value)) ? Math.abs(Number(value)) : 0);

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function reservationGuestName(row: ReservationRow) {
  return row.customer_name?.trim() || row.customer?.name?.trim() || "Guest";
}

type OpenBillItem = {
  id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
};

export function RestaurantPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading restaurant...
        </div>
      }
    >
      <RestaurantPageContent />
    </Suspense>
  );
}

function RestaurantPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const immersive =
    isRestaurantTabletPath(pathname) || isRestaurantImmersive(searchParams);
  const handheldClient = useHandheldClient();
  const tabletHandoff = shouldUseTabletCashierHandoff({
    immersive,
    handheldClient,
  });
  const { data: tables = [], isLoading, error } = useCashierTables();
  const { data: orders = [], refetch: refetchOrders } = useOpenBills({ limit: 200 });
  const createSplitsMutation = useCreateOrderSplits();
  const [selection, setSelection] = useState<NullableRestaurantSelection>(null);
  const [boardMode, setBoardMode] = useState<RestaurantBoardMode>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [transferItems, setTransferItems] = useState<MoveItemsSelection[]>([]);
  const [showMoveItemsDialog, setShowMoveItemsDialog] = useState(false);
  const [showWaitingList, setShowWaitingList] = useState(false);
  const [seatingReservation, setSeatingReservation] =
    useState<ReservationRow | null>(null);
  const [seatingId, setSeatingId] = useState<string | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitPaymentOrder, setSplitPaymentOrder] = useState<Order | null>(null);
  const [billsDrawerOpen, setBillsDrawerOpen] = useState(false);

  const waitingDate = todayIsoDate();
  const {
    data: reservationRows = [],
    isLoading: waitingLoading,
    isError: waitingError,
    refetch: refetchWaitingList,
  } = useReservationList({ date: waitingDate });

  const waitingList = useMemo(() => {
    return reservationRows
      .filter((row) => {
        const status = String(row.status || "").toLowerCase();
        return status === "pending" || status === "confirmed";
      })
      .slice()
      .sort((a, b) =>
        String(a.time_slot || "").localeCompare(String(b.time_slot || ""))
      );
  }, [reservationRows]);

  const tableError = error instanceof Error ? error.message : null;

  const tablesById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]));
  }, [tables]);

  const selectedOrder = useMemo(() => {
    if (!selection?.orderId) return null;
    return orders.find((order) => order.id === selection.orderId) ?? null;
  }, [orders, selection]);

  const openBillsCount = useMemo(() => {
    const checkouts = tables.flatMap((table) =>
      (table.open_checkouts || []).map((checkout) => ({
        id: checkout.id,
        table_id: table.id,
        payment_status: checkout.payment_status,
        checkout_number: checkout.checkout_number,
        total_amount: checkout.total_amount,
      }))
    );
    return listTableBoardBills({ orders, checkouts }).length;
  }, [orders, tables]);

  const selectedTableLabel = useMemo(() => {
    if (!selection?.tableId) return null;
    const table = tablesById.get(selection.tableId);
    return table?.label || table?.table_number || table?.name || null;
  }, [selection?.tableId, tablesById]);

  const splitCartItems = useMemo(() => {
    if (!selectedOrder) return [];

    return ((selectedOrder.items || []) as OpenBillItem[]).map((item, index) => {
      const quantity = Number(item.quantity || 1);
      const totalAmount = Number(item.total_amount || item.subtotal || 0);
      const unitPrice = Number(item.unit_price || (quantity > 0 ? totalAmount / quantity : 0));

      return {
        id: item.id || `${item.product_id || "item"}-${index}`,
        productId: item.product_id || "",
        name: item.product_name || "Item",
        price: unitPrice,
        quantity,
      };
    });
  }, [selectedOrder]);

  const moveItemLines = useMemo(() => {
    if (!selectedOrder) return [];
    return ((selectedOrder.items || []) as OpenBillItem[])
      .filter((item) => item.id)
      .map((item, index) => {
        const quantity = Number(item.quantity || 1);
        const totalAmount = Number(item.total_amount || item.subtotal || 0);
        const unitPrice = Number(
          item.unit_price || (quantity > 0 ? totalAmount / quantity : 0)
        );
        return {
          id: String(item.id),
          name: item.product_name || `Item ${index + 1}`,
          quantity,
          unitPrice,
        };
      });
  }, [selectedOrder]);

  const { availableCount, occupiedCount } = useMemo(() => {
    let available = 0;
    let occupied = 0;
    for (const table of tables) {
      if (table.status === "available") available += 1;
      if (table.status === "occupied" || table.status === "billing") occupied += 1;
    }
    return { availableCount: available, occupiedCount: occupied };
  }, [tables]);

  const exitBoardMode = () => {
    setBoardMode(null);
    setBoardBusy(false);
    setTransferItems([]);
    setSeatingReservation(null);
  };

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: cashierQueryKeys.tables() });
    void queryClient.invalidateQueries({ queryKey: openBillsQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: reservationQueryKeys.all });
    void refetchOrders();
  };

  const executeSeat = async (
    reservation: ReservationRow,
    tableId?: string | null
  ) => {
    const name = reservationGuestName(reservation);
    try {
      setSeatingId(reservation.id);
      setBoardBusy(true);
      const data = await seatReservation(
        reservation.id,
        tableId ? { table_id: tableId } : undefined
      );
      const order = data.order;
      const seatedTableId = order.table_id || tableId || null;
      toast.success(`${name} seated.`, {
        description: order.order_number
          ? `Open bill ${order.order_number}`
          : "Empty open bill created",
      });
      setShowWaitingList(false);
      exitBoardMode();
      if (seatedTableId && order.id) {
        setSelection(tableSelection(seatedTableId, order.id));
      } else {
        setSelection(null);
      }
      refreshBoard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to seat guest");
    } finally {
      setSeatingId(null);
      setBoardBusy(false);
    }
  };

  const handleWaitingListSeat = async (reservation: ReservationRow) => {
    if (seatingId || boardBusy) return;

    const assignedId = reservation.table_id;
    const assigned = assignedId ? tablesById.get(assignedId) : undefined;
    const canUseAssigned =
      Boolean(assigned) &&
      canPickSeatDestination(assigned!, { sourceTableId: null });

    if (canUseAssigned && assignedId) {
      await executeSeat(reservation, assignedId);
      return;
    }

    if (assignedId && assigned && !canUseAssigned) {
      toast.message("Assigned table is not available.", {
        description: "Pick another available table on the floor plan.",
      });
    }

    setShowWaitingList(false);
    setTransferItems([]);
    setSeatingReservation(reservation);
    setBoardMode("seat");
    toast.message(`Seat ${reservationGuestName(reservation)}`, {
      description: "Tap an available table on the floor plan.",
    });
  };

  const handleSelectOccupied = (table: PosTable) => {
    if (boardMode) {
      exitBoardMode();
    }
    const alreadySelected = isTableSelected(selection, table.id);
    setSelection(
      alreadySelected ? null : tableSelection(table.id, table.active_order?.id)
    );
    if (alreadySelected) {
      toast.message("Cleared table selection.");
      return;
    }

    toast.message(`Selected ${table.label || table.table_number || "table"}.`, {
      description:
        (table.bill_count ?? 0) > 1
          ? `${table.bill_count} open bills — pick one from View Orders or double-click to open.`
          : "Double-click the table to open its bill in the cashier.",
    });
  };

  const handleSelectBill = (nextSelection: RestaurantSelection) => {
    if (boardMode) {
      exitBoardMode();
    }
    setSelection(nextSelection);
  };

  const handleStartMove = () => {
    if (boardMode === "move") {
      exitBoardMode();
      toast.message("Move cancelled.");
      return;
    }
    setTransferItems([]);
    setSeatingReservation(null);
    setBoardMode("move");
    toast.message("Select an available or occupied table.", {
      description: "Tap a table on the floor plan to move this bill onto it.",
    });
  };

  const handleStartMoveItems = () => {
    if (!selectedOrder) return;
    if (boardMode) exitBoardMode();
    setShowMoveItemsDialog(true);
  };

  const handleStartMerge = () => {
    if (boardMode === "merge") {
      exitBoardMode();
      toast.message("Merge cancelled.");
      return;
    }
    setTransferItems([]);
    setSeatingReservation(null);
    setBoardMode("merge");
    toast.message("Select an occupied table.", {
      description: "Tap a destination bill to merge into.",
    });
  };

  const handlePickDestination = async (table: PosTable) => {
    if (boardBusy || !boardMode) return;

    const label = table.label || table.table_number || table.name || "table";

    if (boardMode === "seat") {
      if (!seatingReservation) {
        toast.error("No reservation selected to seat");
        exitBoardMode();
        return;
      }
      await executeSeat(seatingReservation, table.id);
      return;
    }

    if (!selectedOrder) return;

    if (boardMode === "move") {
      try {
        setBoardBusy(true);
        const res = await moveOrderTable(selectedOrder.id, table.id);
        if (!res.success) {
          toast.error(res.error || "Failed to move table");
          return;
        }
        toast.success(`Moved to ${label}.`);
        exitBoardMode();
        setSelection(null);
        refreshBoard();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move table");
      } finally {
        setBoardBusy(false);
      }
      return;
    }

    if (boardMode === "transfer") {
      if (transferItems.length === 0) {
        toast.error("No items selected to move");
        return;
      }
      try {
        setBoardBusy(true);
        const res = await transferOrderItems(selectedOrder.id, {
          target_table_id: table.id,
          items: transferItems,
        });
        if (!res.success) {
          toast.error(res.error || "Failed to move items");
          return;
        }
        const qty = transferItems.reduce((sum, item) => sum + item.qty, 0);
        toast.success(`Moved ${qty} item${qty === 1 ? "" : "s"} to ${label}.`);
        const targetOrderId = res.data?.target_order_id;
        const movedAll =
          moveItemLines.reduce((s, l) => s + l.quantity, 0) === qty;
        exitBoardMode();
        if (!movedAll && selectedOrder) {
          // Keep source selection when items remain.
          setSelection(
            tableSelection(
              selection?.tableId ?? selectedOrder.table_id ?? table.id,
              selectedOrder.id
            )
          );
        } else if (targetOrderId) {
          setSelection(tableSelection(table.id, targetOrderId));
        } else {
          setSelection(null);
        }
        refreshBoard();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move items");
      } finally {
        setBoardBusy(false);
      }
      return;
    }

    if (boardMode === "merge") {
      const destOrders = table.active_orders || [];
      const sourceBill = {
        checkout_id: selectedOrder.checkout_id ?? null,
        sold_from: selectedOrder.sold_from ?? null,
      };
      if (!canMergeIntoDestination(sourceBill, destOrders)) {
        toast.error("Tidak bisa merge tagihan stall ke kasir pusat");
        return;
      }
      const targetOrder = destOrders.find((order) =>
        canAppendTransferItems(sourceBill, order)
      );
      const targetOrderId = targetOrder?.id;
      if (!targetOrderId) {
        toast.error("Destination table has no open bill");
        return;
      }
      try {
        setBoardBusy(true);
        const res = await mergeOrders(selectedOrder.id, targetOrderId);
        if (!res.success) {
          toast.error(res.error || "Failed to merge tables");
          return;
        }
        toast.success(`Merged into ${label}.`);
        exitBoardMode();
        setSelection(tableSelection(table.id, targetOrderId));
        refreshBoard();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to merge tables");
      } finally {
        setBoardBusy(false);
      }
    }
  };

  const handleConfirmSplit = async (config: SplitConfig) => {
    if (!selectedOrder) return;

    try {
      await createSplitsMutation.mutateAsync({
        orderId: selectedOrder.id,
        payload: {
          splits: config.splits.map((split) => ({
            label: split.label,
            subtotal: split.subtotal || 0,
            tax_amount: split.tax_amount || 0,
            discount_amount: split.discount_amount || 0,
            total_amount: split.total,
            customer_id: split.customerId,
            items: split.items,
          })),
        },
      });
      toast.success("Split bill created.");
      setShowSplitModal(false);
      setSplitPaymentOrder(selectedOrder);
      void refetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create split bill");
    }
  };

  return (
    <PageTransition
      className={cn("space-y-3", immersive ? "p-3 sm:p-4" : "space-y-4")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Restaurant</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PosTabletChromeControls
            immersive={immersive}
            ordersHref={buildPosOrdersUrl({ from: "restaurant", tablet: immersive })}
            onToggleImmersive={(next) => {
              router.replace(restaurantPath({ immersive: next }));
            }}
          />
        </div>
      </div>

      {boardMode === "seat" && seatingReservation ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Seat {reservationGuestName(seatingReservation)} — tap an available
              table
            </p>
            <p className="text-xs text-muted-foreground">
              {boardBusy
                ? "Seating…"
                : `${seatingReservation.time_slot || "—"} · ${seatingReservation.pax_count} pax`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-gray-200/80"
            disabled={boardBusy}
            onClick={() => {
              exitBoardMode();
              toast.message("Seat cancelled.");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : boardMode && selectedOrder ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {boardMode === "move"
                ? `Move ${selectedOrder.order_number} — tap an available or occupied table`
                : boardMode === "transfer"
                  ? `Move ${transferItems.reduce((s, i) => s + i.qty, 0)} items — tap a table`
                  : `Merge ${selectedOrder.order_number} — tap an occupied table`}
            </p>
            <p className="text-xs text-muted-foreground">
              {boardBusy
                ? boardMode === "move"
                  ? "Moving…"
                  : boardMode === "transfer"
                    ? "Transferring…"
                    : "Merging…"
                : selectedTableLabel
                  ? `From ${selectedTableLabel}`
                  : "Choose a destination on the floor plan"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-gray-200/80"
            onClick={() => {
              exitBoardMode();
              toast.message(
                boardMode === "merge"
                  ? "Merge cancelled."
                  : boardMode === "transfer"
                    ? "Move items cancelled."
                    : "Move cancelled."
              );
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <div className={restaurantWorkspaceClass(immersive)}>
        <RestaurantActionRail
          selection={selection}
          selectedOrder={selectedOrder}
          selectedTableLabel={selectedTableLabel}
          availableCount={availableCount}
          occupiedCount={occupiedCount}
          openBillsCount={openBillsCount}
          onSplitBill={() => setShowSplitModal(true)}
          onPaySplits={() => {
            if (!selectedOrder) {
              toast.error("Select an occupied table or bill");
              return;
            }
            setSplitPaymentOrder(selectedOrder);
          }}
          onMoveTable={handleStartMove}
          onMoveItems={handleStartMoveItems}
          onMergeTable={handleStartMerge}
          onWaitingList={() => {
            if (boardMode) exitBoardMode();
            setShowWaitingList(true);
            void refetchWaitingList();
          }}
          onViewOrders={() => setBillsDrawerOpen(true)}
        />

        <Card className="min-h-0 min-w-0 overflow-auto border-gray-200/70 shadow-xs">
          <CardContent className="p-4 sm:p-6">
            <RestaurantTableBoard
              tables={tables}
              isLoading={isLoading}
              error={tableError}
              selectedTableId={selection?.tableId ?? null}
              immersive={tabletHandoff}
              boardMode={boardMode}
              busy={boardBusy}
              sourceTableId={selection?.tableId ?? null}
              sourceBill={
                selectedOrder
                  ? {
                      checkout_id: selectedOrder.checkout_id ?? null,
                      sold_from: selectedOrder.sold_from ?? null,
                    }
                  : undefined
              }
              onSelectOccupied={handleSelectOccupied}
              onPickDestination={handlePickDestination}
            />
            {selection?.tableId ? (
              <div className="mt-4 border-t border-gray-200/70 pt-4">
                <RestaurantBillsRail
                  variant="panel"
                  tablesById={tablesById}
                  selection={selection}
                  immersive={tabletHandoff}
                  filterTableId={selection.tableId}
                  onSelect={(next) => {
                    handleSelectBill(next);
                    toast.message("Bill selected.");
                  }}
                  onPaySplits={(order) => {
                    setSplitPaymentOrder(order);
                  }}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Sheet open={billsDrawerOpen} onOpenChange={setBillsDrawerOpen}>
        <SheetContent
          side="right"
          className="h-full w-full gap-0 border-l border-gray-200/70 p-0 sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Open Bills</SheetTitle>
            <SheetDescription>
              Select a bill to use restaurant actions.
            </SheetDescription>
          </SheetHeader>
          <RestaurantBillsRail
            variant="drawer"
            tablesById={tablesById}
            selection={selection}
            immersive={tabletHandoff}
            onSelect={(next) => {
              handleSelectBill(next);
              toast.message("Bill selected.");
            }}
            onPaySplits={(order) => {
              setBillsDrawerOpen(false);
              setSplitPaymentOrder(order);
            }}
          />
        </SheetContent>
      </Sheet>

      <MoveItemsDialog
        open={showMoveItemsDialog}
        lines={moveItemLines}
        formatCurrency={formatCurrency}
        onClose={() => setShowMoveItemsDialog(false)}
        onContinue={(items) => {
          setShowMoveItemsDialog(false);
          setTransferItems(items);
          setSeatingReservation(null);
          setBoardMode("transfer");
          toast.message("Select a destination table.", {
            description: "Tap an available or occupied table on the floor plan.",
          });
        }}
      />

      <WaitingListDialog
        open={showWaitingList}
        onOpenChange={setShowWaitingList}
        reservations={waitingList}
        loading={waitingLoading}
        error={waitingError}
        seatingId={seatingId}
        tablesById={tablesById}
        onSeat={handleWaitingListSeat}
      />

      <SplitBillModal
        open={showSplitModal}
        total={Number(selectedOrder?.total_amount || 0)}
        subtotal={Number(selectedOrder?.subtotal || selectedOrder?.total_amount || 0)}
        taxAmount={Number(selectedOrder?.tax_amount || 0)}
        discountAmount={Number(selectedOrder?.discount_amount || 0)}
        cartItems={splitCartItems}
        onClose={() => setShowSplitModal(false)}
        onConfirm={handleConfirmSplit}
        confirming={createSplitsMutation.isPending}
        formatCurrency={formatCurrency}
      />

      {splitPaymentOrder && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 lg:p-6">
          <SplitPaymentScreen
            orderId={splitPaymentOrder.id}
            orderNumber={splitPaymentOrder.order_number}
            orderType={splitPaymentOrder.order_type}
            table={splitPaymentOrder.table?.table_number || splitPaymentOrder.table?.qr_code}
            items={splitPaymentOrder.items || []}
            notes={splitPaymentOrder.notes}
            total={Number(splitPaymentOrder.total_amount || 0)}
            taxAmount={Number(splitPaymentOrder.tax_amount || 0)}
            discountAmount={Number(splitPaymentOrder.discount_amount || 0)}
            customerName={orderCustomerName(splitPaymentOrder) ?? undefined}
            onBack={() => setSplitPaymentOrder(null)}
            onComplete={() => {
              setSplitPaymentOrder(null);
              setSelection(null);
              void refetchOrders();
            }}
            formatCurrency={formatCurrency}
            formatArk={(value) => `${(value / 1000).toLocaleString("id-ID")} ARK`}
          />
        </div>
      )}
    </PageTransition>
  );
}
