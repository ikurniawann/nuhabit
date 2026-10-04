// Aturan murni papan Restaurant: baris pindah item, hitungan meja, daftar
// tunggu, dan teks banner mode papan.
import type { Order, PosTable } from "@/lib/pos-api";
import type { ReservationRow } from "@/features/pos/reservation/types";
import type { RestaurantBoardMode } from "./components/restaurant-table-board";

export const reservationGuestName = (row: ReservationRow) =>
  row.customer_name?.trim() || row.customer?.name?.trim() || "Guest";

/** Baris bill yang bisa dipindah ke meja lain (item tersimpan, ber-id). */
export function orderMoveLines(order: Order | null) {
  if (!order) return [];
  return (order.items || [])
    .filter((item) => item.id)
    .map((item, index) => {
      const quantity = Number(item.quantity || 1);
      const totalAmount = Number(item.total_amount || item.subtotal || 0);
      return {
        id: String(item.id),
        name: item.product_name || `Item ${index + 1}`,
        quantity,
        unitPrice: Number(item.unit_price || (quantity > 0 ? totalAmount / quantity : 0)),
      };
    });
}

export function countTableStatuses(tables: Array<Pick<PosTable, "status">>) {
  let availableCount = 0;
  let occupiedCount = 0;
  for (const table of tables) {
    if (table.status === "available") availableCount += 1;
    if (table.status === "occupied" || table.status === "billing") occupiedCount += 1;
  }
  return { availableCount, occupiedCount };
}

/** Daftar tunggu = reservasi pending/confirmed, urut jam. */
export function waitingListFrom(rows: ReservationRow[]) {
  return rows
    .filter((row) => {
      const status = String(row.status || "").toLowerCase();
      return status === "pending" || status === "confirmed";
    })
    .sort((a, b) => String(a.time_slot || "").localeCompare(String(b.time_slot || "")));
}

type ActiveMode = Exclude<RestaurantBoardMode, null>;

export const BOARD_CANCEL_MESSAGE: Record<ActiveMode, string> = {
  move: "Move cancelled.",
  transfer: "Move items cancelled.",
  merge: "Merge cancelled.",
  seat: "Seat cancelled.",
};

/** Teks banner saat papan menunggu meja tujuan (pindah/pindah item/merge). */
export function boardBanner(input: {
  mode: Exclude<ActiveMode, "seat">;
  orderNumber?: string | null;
  transferQty: number;
  busy: boolean;
  sourceLabel: string | null;
}) {
  const title =
    input.mode === "move"
      ? `Move ${input.orderNumber} — tap an available or occupied table`
      : input.mode === "transfer"
        ? `Move ${input.transferQty} items — tap a table`
        : `Merge ${input.orderNumber} — tap an occupied table`;
  const busyText = input.mode === "move" ? "Moving…" : input.mode === "transfer" ? "Transferring…" : "Merging…";
  const subtitle = input.busy
    ? busyText
    : input.sourceLabel
      ? `From ${input.sourceLabel}`
      : "Choose a destination on the floor plan";
  return { title, subtitle };
}
