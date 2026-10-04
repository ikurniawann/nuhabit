"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { buildPosOrdersUrl } from "@/features/pos/cashier/constants";
import { cashierQueryKeys } from "@/features/pos/cashier/query-keys";
import { useCashierTables } from "@/features/pos/cashier/queries";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import { openBillsQueryKeys } from "@/features/pos/open-bills/query-keys";
import { useCreateOrderSplits } from "@/features/pos/open-bills/mutations";
import type { Order } from "@/features/pos/open-bills/types";
import { SplitBillModal, type SplitConfig } from "@/components/pos/SplitBillModal";
import { SplitPaymentScreen } from "@/components/pos/SplitPaymentScreen";
import { cn } from "@/lib/utils";
import { PosTabletChromeControls } from "@/features/pos/components/pos-tablet-chrome-controls";
import { useHandheldClient } from "@/features/pos/use-handheld-client";
import { useReservationList } from "@/features/pos/reservation/queries";
import { reservationQueryKeys } from "@/features/pos/reservation/query-keys";
import { localDateKey } from "@/features/pos/reservation/reservation-rules";
import { orderCustomerName } from "@/lib/pos/order-customer";
import { listTableBoardBills } from "@/lib/pos/tables/table-board-bills";
import { formatNumber, formatRupiah } from "@/lib/format";

import { MoveItemsDialog } from "./move-items-dialog";
import { RestaurantActionRail } from "./restaurant-action-rail";
import { RestaurantBillsRail } from "./restaurant-bills-rail";
import { RestaurantTableBoard } from "./restaurant-table-board";
import { WaitingListDialog } from "./waiting-list-dialog";
import { isRestaurantImmersive, isRestaurantTabletPath, restaurantPath, shouldUseTabletCashierHandoff } from "../nav";
import { restaurantWorkspaceClass } from "../restaurant-workspace-layout";
import { boardBanner, countTableStatuses, orderMoveLines, reservationGuestName, waitingListFrom } from "../board-rules";
import { orderItemsToCartItems } from "../order-to-receipt";
import { useRestaurantBoard } from "../use-restaurant-board";

const formatCurrency = (value: number) => formatRupiah(Math.abs(Number(value) || 0));

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
  const immersive = isRestaurantTabletPath(pathname) || isRestaurantImmersive(searchParams);
  const handheldClient = useHandheldClient();
  const tabletHandoff = shouldUseTabletCashierHandoff({ immersive, handheldClient });
  const { data: tables = [], isLoading, error } = useCashierTables();
  const { data: orders = [], refetch: refetchOrders } = useOpenBills({ limit: 200 });
  const createSplitsMutation = useCreateOrderSplits();
  const [showMoveItemsDialog, setShowMoveItemsDialog] = useState(false);
  const [showWaitingList, setShowWaitingList] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitPaymentOrder, setSplitPaymentOrder] = useState<Order | null>(null);
  const [billsDrawerOpen, setBillsDrawerOpen] = useState(false);

  const {
    data: reservationRows = [],
    isLoading: waitingLoading,
    isError: waitingError,
    refetch: refetchWaitingList,
  } = useReservationList({ date: localDateKey() });
  const waitingList = useMemo(() => waitingListFrom(reservationRows), [reservationRows]);

  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables]);
  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: cashierQueryKeys.tables() });
    void queryClient.invalidateQueries({ queryKey: openBillsQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: reservationQueryKeys.all });
    void refetchOrders();
  };
  const board = useRestaurantBoard({
    orders,
    tablesById,
    refreshBoard,
    closeWaitingList: () => setShowWaitingList(false),
  });
  const { selection, selectedOrder, boardMode, boardBusy, seatingReservation } = board;

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

  const selectedTable = selection?.tableId ? tablesById.get(selection.tableId) : undefined;
  const selectedTableLabel = selectedTable?.label || selectedTable?.table_number || selectedTable?.name || null;
  const splitCartItems = useMemo(() => (selectedOrder ? orderItemsToCartItems(selectedOrder) : []), [selectedOrder]);
  const moveItemLines = useMemo(() => orderMoveLines(selectedOrder), [selectedOrder]);
  const { availableCount, occupiedCount } = useMemo(() => countTableStatuses(tables), [tables]);

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
        <BoardBanner
          title={`Seat ${reservationGuestName(seatingReservation)} — tap an available table`}
          subtitle={
            boardBusy ? "Seating…" : `${seatingReservation.time_slot || "—"} · ${seatingReservation.pax_count} pax`
          }
          cancelDisabled={boardBusy}
          onCancel={board.cancelBoardMode}
        />
      ) : boardMode && boardMode !== "seat" && selectedOrder ? (
        <BoardBanner
          {...boardBanner({
            mode: boardMode,
            orderNumber: selectedOrder.order_number,
            transferQty: board.transferItems.reduce((sum, item) => sum + item.qty, 0),
            busy: boardBusy,
            sourceLabel: selectedTableLabel,
          })}
          onCancel={board.cancelBoardMode}
        />
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
          onMoveTable={board.toggleMove}
          onMoveItems={() => {
            if (!selectedOrder) return;
            if (boardMode) board.exitBoardMode();
            setShowMoveItemsDialog(true);
          }}
          onMergeTable={board.toggleMerge}
          onWaitingList={() => {
            if (boardMode) board.exitBoardMode();
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
              error={error instanceof Error ? error.message : null}
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
              onSelectOccupied={board.selectOccupied}
              onPickDestination={(table) => void board.pickDestination(table)}
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
                    board.selectBill(next);
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
              board.selectBill(next);
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
          board.startTransfer(items);
        }}
      />

      <WaitingListDialog
        open={showWaitingList}
        onOpenChange={setShowWaitingList}
        reservations={waitingList}
        loading={waitingLoading}
        error={waitingError}
        seatingId={board.seatingId}
        tablesById={tablesById}
        onSeat={board.seatFromWaitingList}
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
            items={orderItemsToCartItems(splitPaymentOrder)}
            notes={splitPaymentOrder.notes}
            total={Number(splitPaymentOrder.total_amount || 0)}
            customerName={orderCustomerName(splitPaymentOrder) ?? undefined}
            onBack={() => setSplitPaymentOrder(null)}
            onComplete={() => {
              setSplitPaymentOrder(null);
              board.setSelection(null);
              void refetchOrders();
            }}
            formatCurrency={formatCurrency}
            formatArk={(value) => `${formatNumber(value / 1000, 3)} ARK`}
          />
        </div>
      )}
    </PageTransition>
  );
}

function BoardBanner({
  title,
  subtitle,
  cancelDisabled = false,
  onCancel,
}: {
  title: string;
  subtitle: string;
  cancelDisabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Button type="button" variant="outline" className="shrink-0 border-gray-200/80" disabled={cancelDisabled} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
