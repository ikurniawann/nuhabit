import {
  canMergeIntoDestination,
  type TableBillFamily,
} from "@/lib/pos/table-sale-target";

export type MoveDestinationTable = {
  id: string;
  status?: string | null;
  is_active?: boolean | null;
};

function normalizedStatus(table: MoveDestinationTable) {
  return String(table.status || "").toLowerCase();
}

function isActiveTable(table: MoveDestinationTable) {
  return table.is_active !== false;
}

function isNotSource(
  table: MoveDestinationTable,
  sourceTableId?: string | null
) {
  return !(sourceTableId && table.id === sourceTableId);
}

export function canPickMoveDestination(
  table: MoveDestinationTable,
  opts: { sourceTableId?: string | null }
): boolean {
  if (!isNotSource(table, opts.sourceTableId)) return false;
  if (!isActiveTable(table)) return false;
  const status = normalizedStatus(table);
  return status === "available" || status === "occupied" || status === "billing";
}

/** Move Items: empty (available) or occupied/billing destination. */
export function canPickTransferDestination(
  table: MoveDestinationTable,
  opts: { sourceTableId?: string | null }
): boolean {
  if (!isNotSource(table, opts.sourceTableId)) return false;
  if (!isActiveTable(table)) return false;
  const status = normalizedStatus(table);
  return status === "available" || status === "occupied" || status === "billing";
}

/** Merge Table: occupied/billing destination only. */
export function canPickMergeDestination(
  table: MoveDestinationTable,
  opts: {
    sourceTableId?: string | null;
    sourceBill?: TableBillFamily;
    destOrders?: TableBillFamily[];
  }
): boolean {
  if (!isNotSource(table, opts.sourceTableId)) return false;
  if (!isActiveTable(table)) return false;
  const status = normalizedStatus(table);
  if (status !== "occupied" && status !== "billing") return false;
  if (opts.sourceBill && opts.destOrders) {
    return canMergeIntoDestination(opts.sourceBill, opts.destOrders);
  }
  return true;
}

/** Seat reservation: available tables only. */
export function canPickSeatDestination(
  table: MoveDestinationTable,
  opts: { sourceTableId?: string | null } = {}
): boolean {
  if (!isNotSource(table, opts.sourceTableId)) return false;
  if (!isActiveTable(table)) return false;
  return normalizedStatus(table) === "available";
}
