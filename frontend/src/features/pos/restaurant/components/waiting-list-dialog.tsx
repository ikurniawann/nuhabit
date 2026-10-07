"use client";

import Link from "next/link";
import { Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import type { ReservationRow } from "@/features/pos/reservation/types";
import type { PosTable } from "@/lib/pos-api";
import { cn } from "@/lib/utils";

function guestName(row: ReservationRow) {
  return (
    row.customer_name?.trim() ||
    row.customer?.name?.trim() ||
    "Guest"
  );
}

function tableLabel(
  row: ReservationRow,
  tablesById: Map<string, PosTable>
) {
  if (row.table_id) {
    const table = tablesById.get(row.table_id);
    const fromFloor =
      table?.label || table?.table_number || table?.name || null;
    if (fromFloor) return fromFloor;
  }
  return row.table?.table_number?.trim() || "Unassigned";
}

export interface WaitingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservations: ReservationRow[];
  loading?: boolean;
  error?: boolean;
  seatingId?: string | null;
  tablesById: Map<string, PosTable>;
  onSeat: (reservation: ReservationRow) => void;
}

export function WaitingListDialog({
  open,
  onOpenChange,
  reservations,
  loading = false,
  error = false,
  seatingId = null,
  tablesById,
  onSeat,
}: WaitingListDialogProps) {
  const busy = Boolean(seatingId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Waiting List</DialogPanelTitle>
          <DialogPanelDescription>
            Today&apos;s pending and confirmed reservations
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading guests…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200/80 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
              Could not load waiting list.
            </div>
          ) : reservations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 px-4 py-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground/70" />
              <p className="text-sm font-medium text-foreground">
                No guests waiting today.
              </p>
              <p className="text-xs text-muted-foreground">
                New reservations appear here when pending or confirmed.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200/70 overflow-hidden rounded-lg border border-gray-200/70">
              {reservations.map((row) => {
                const isSeating = seatingId === row.id;
                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 bg-card px-3 py-3 sm:px-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {guestName(row)}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          · {row.pax_count} pax
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.time_slot || "—"} · {tableLabel(row, tablesById)}
                        <span className="capitalize"> · {row.status}</span>
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className={cn("shrink-0")}
                      disabled={busy}
                      onClick={() => onSeat(row)}
                    >
                      {isSeating ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Seating…
                        </>
                      ) : (
                        "Seat"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanelBody>

        <DialogFooter className="sm:justify-between">
          <Link
            href="/dashboard/pos/reservation"
            className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Manage reservations
          </Link>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
