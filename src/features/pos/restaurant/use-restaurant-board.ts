"use client";

import { useState } from "react";
import { toast } from "sonner";
import { seatReservation } from "@/features/pos/reservation/api";
import type { ReservationRow } from "@/features/pos/reservation/types";
import { mergeOrders, moveOrderTable, transferOrderItems, type Order, type PosTable } from "@/lib/pos-api";
import { canAppendTransferItems, canMergeIntoDestination } from "@/lib/pos/table-sale-target";
import { BOARD_CANCEL_MESSAGE, orderMoveLines, reservationGuestName } from "./board-rules";
import type { MoveItemsSelection } from "./components/move-items-dialog";
import type { RestaurantBoardMode } from "./components/restaurant-table-board";
import { canPickSeatDestination } from "./move-destination";
import { isTableSelected, tableSelection, type NullableRestaurantSelection, type RestaurantSelection } from "./selection";

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * Seleksi meja/bill dan mode papan Restaurant (pindah meja, pindah item,
 * merge, dudukkan tamu daftar tunggu). Setiap aksi server memanggil
 * `refreshBoard` agar denah & daftar bill ikut segar.
 */
export function useRestaurantBoard(input: {
  orders: Order[];
  tablesById: Map<string, PosTable>;
  refreshBoard: () => void;
  closeWaitingList: () => void;
}) {
  const { orders, tablesById, refreshBoard } = input;
  const [selection, setSelection] = useState<NullableRestaurantSelection>(null);
  const [boardMode, setBoardMode] = useState<RestaurantBoardMode>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [transferItems, setTransferItems] = useState<MoveItemsSelection[]>([]);
  const [seatingReservation, setSeatingReservation] = useState<ReservationRow | null>(null);
  const [seatingId, setSeatingId] = useState<string | null>(null);

  const selectedOrder = selection?.orderId ? (orders.find((order) => order.id === selection.orderId) ?? null) : null;

  const exitBoardMode = () => {
    setBoardMode(null);
    setBoardBusy(false);
    setTransferItems([]);
    setSeatingReservation(null);
  };

  const cancelBoardMode = () => {
    if (boardMode) toast.message(BOARD_CANCEL_MESSAGE[boardMode]);
    exitBoardMode();
  };

  const enterMode = (mode: Exclude<RestaurantBoardMode, null>, hint: string, description: string) => {
    setTransferItems([]);
    setSeatingReservation(null);
    setBoardMode(mode);
    toast.message(hint, { description });
  };

  /** Jalankan aksi papan dengan status busy + pesan galat seragam. */
  async function runBoardAction(fallback: string, action: () => Promise<void>) {
    try {
      setBoardBusy(true);
      await action();
    } catch (err) {
      toast.error(errorText(err, fallback));
    } finally {
      setBoardBusy(false);
    }
  }

  async function executeSeat(reservation: ReservationRow, tableId?: string | null) {
    const name = reservationGuestName(reservation);
    setSeatingId(reservation.id);
    await runBoardAction("Failed to seat guest", async () => {
      const { order } = await seatReservation(reservation.id, tableId ? { table_id: tableId } : undefined);
      const seatedTableId = order.table_id || tableId || null;
      toast.success(`${name} seated.`, {
        description: order.order_number ? `Open bill ${order.order_number}` : "Empty open bill created",
      });
      input.closeWaitingList();
      exitBoardMode();
      setSelection(seatedTableId && order.id ? tableSelection(seatedTableId, order.id) : null);
      refreshBoard();
    });
    setSeatingId(null);
  }

  /** Daftar tunggu: meja yang sudah ditetapkan & masih bisa dipakai langsung dipakai; selain itu pilih di denah. */
  async function seatFromWaitingList(reservation: ReservationRow) {
    if (seatingId || boardBusy) return;
    const assignedId = reservation.table_id;
    const assigned = assignedId ? tablesById.get(assignedId) : undefined;
    if (assignedId && assigned && canPickSeatDestination(assigned, { sourceTableId: null })) {
      await executeSeat(reservation, assignedId);
      return;
    }
    if (assignedId && assigned) {
      toast.message("Assigned table is not available.", {
        description: "Pick another available table on the floor plan.",
      });
    }
    input.closeWaitingList();
    setTransferItems([]);
    setSeatingReservation(reservation);
    setBoardMode("seat");
    toast.message(`Seat ${reservationGuestName(reservation)}`, {
      description: "Tap an available table on the floor plan.",
    });
  }

  function selectOccupied(table: PosTable) {
    if (boardMode) exitBoardMode();
    const alreadySelected = isTableSelected(selection, table.id);
    setSelection(alreadySelected ? null : tableSelection(table.id, table.active_order?.id));
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
  }

  function selectBill(next: RestaurantSelection) {
    if (boardMode) exitBoardMode();
    setSelection(next);
  }

  function toggleMove() {
    if (boardMode === "move") return cancelBoardMode();
    enterMode("move", "Select an available or occupied table.", "Tap a table on the floor plan to move this bill onto it.");
  }

  function toggleMerge() {
    if (boardMode === "merge") return cancelBoardMode();
    enterMode("merge", "Select an occupied table.", "Tap a destination bill to merge into.");
  }

  function startTransfer(items: MoveItemsSelection[]) {
    setSeatingReservation(null);
    setBoardMode("transfer");
    setTransferItems(items);
    toast.message("Select a destination table.", {
      description: "Tap an available or occupied table on the floor plan.",
    });
  }

  async function moveBill(order: Order, table: PosTable, label: string) {
    await runBoardAction("Failed to move table", async () => {
      const res = await moveOrderTable(order.id, table.id);
      if (!res.success) {
        toast.error(res.error || "Failed to move table");
        return;
      }
      toast.success(`Moved to ${label}.`);
      exitBoardMode();
      setSelection(null);
      refreshBoard();
    });
  }

  async function transferItemsTo(order: Order, table: PosTable, label: string) {
    if (transferItems.length === 0) {
      toast.error("No items selected to move");
      return;
    }
    await runBoardAction("Failed to move items", async () => {
      const res = await transferOrderItems(order.id, { target_table_id: table.id, items: transferItems });
      if (!res.success) {
        toast.error(res.error || "Failed to move items");
        return;
      }
      const qty = transferItems.reduce((sum, item) => sum + item.qty, 0);
      toast.success(`Moved ${qty} item${qty === 1 ? "" : "s"} to ${label}.`);
      const targetOrderId = res.data?.target_order_id;
      const movedAll = orderMoveLines(order).reduce((sum, line) => sum + line.quantity, 0) === qty;
      exitBoardMode();
      if (!movedAll) {
        // Sisa item tetap di bill asal → seleksi tetap di sana.
        setSelection(tableSelection(selection?.tableId ?? order.table_id ?? table.id, order.id));
      } else {
        setSelection(targetOrderId ? tableSelection(table.id, targetOrderId) : null);
      }
      refreshBoard();
    });
  }

  async function mergeInto(order: Order, table: PosTable, label: string) {
    const destOrders = table.active_orders || [];
    const sourceBill = { checkout_id: order.checkout_id ?? null, sold_from: order.sold_from ?? null };
    if (!canMergeIntoDestination(sourceBill, destOrders)) {
      toast.error("Tidak bisa merge tagihan stall ke kasir pusat");
      return;
    }
    const targetOrderId = destOrders.find((dest) => canAppendTransferItems(sourceBill, dest))?.id;
    if (!targetOrderId) {
      toast.error("Destination table has no open bill");
      return;
    }
    await runBoardAction("Failed to merge tables", async () => {
      // Termasuk 429 bila PIN supervisor diminta & kasir sedang terkunci.
      const res = await mergeOrders(order.id, targetOrderId);
      if (!res.success) {
        toast.error(res.error || "Failed to merge tables");
        return;
      }
      toast.success(`Merged into ${label}.`);
      exitBoardMode();
      setSelection(tableSelection(table.id, targetOrderId));
      refreshBoard();
    });
  }

  /** Meja tujuan diketuk saat papan dalam mode seat/move/transfer/merge. */
  async function pickDestination(table: PosTable) {
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
    if (boardMode === "move") await moveBill(selectedOrder, table, label);
    else if (boardMode === "transfer") await transferItemsTo(selectedOrder, table, label);
    else await mergeInto(selectedOrder, table, label);
  }

  return {
    selection,
    setSelection,
    selectedOrder,
    boardMode,
    boardBusy,
    transferItems,
    seatingReservation,
    seatingId,
    exitBoardMode,
    cancelBoardMode,
    seatFromWaitingList,
    selectOccupied,
    selectBill,
    toggleMove,
    toggleMerge,
    startTransfer,
    pickDestination,
  };
}
