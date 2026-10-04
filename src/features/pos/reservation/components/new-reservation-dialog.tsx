"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEPOSIT_PRESETS,
  depositLabel,
  emptyReservationForm,
  groupTablesByFloor,
  isReservationFormComplete,
  ORDER_TYPES,
  TIME_SLOT_OPTIONS,
  tableDisplayName,
  type ReservationForm,
} from "../reservation-rules";
import type { ReservationCustomer, ReservationTable } from "../types";
import { CustomerPickerDialog } from "./customer-picker-dialog";

export const chipClass = (active: boolean) =>
  cn(
    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-primary/30 bg-primary/10 text-brand-text"
      : "border-gray-200/80 bg-card text-muted-foreground hover:border-primary/20 hover:bg-primary/5 hover:text-foreground",
  );

const fieldInputClass =
  "h-9 w-full rounded-md border border-gray-200/80 bg-background px-3 text-sm shadow-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/30";

/** Form reservasi baru. Di-mount tiap kali dibuka, jadi draf selalu mulai dari tanggal terpilih. */
export function NewReservationDialog({
  initialDate,
  customers,
  tables,
  submitting,
  onSubmit,
  onClose,
}: {
  initialDate: string;
  customers: ReservationCustomer[];
  tables: ReservationTable[];
  submitting: boolean;
  onSubmit: (form: ReservationForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => emptyReservationForm(initialDate));
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const tableGroups = useMemo(() => groupTablesByFloor(tables), [tables]);
  const patch = (next: Partial<ReservationForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>New Reservation</DialogPanelTitle>
            <DialogPanelDescription>
              Book a table for a guest. Table is optional.
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Customer</Label>
              <button
                type="button"
                onClick={() => setPickingCustomer(true)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-gray-200/80 px-3 text-left text-sm hover:border-primary/30 hover:bg-primary/5"
              >
                <span
                  className={
                    form.customerName
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {form.customerName || "Find customer…"}
                </span>
                <Search className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="reservation-name"
                  className="text-xs text-muted-foreground"
                >
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="reservation-name"
                  value={form.customerName}
                  onChange={(e) => patch({ customerName: e.target.value })}
                  className={fieldInputClass}
                  placeholder="Guest name"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="reservation-phone"
                  className="text-xs text-muted-foreground"
                >
                  Phone
                </Label>
                <Input
                  id="reservation-phone"
                  value={form.customerPhone}
                  onChange={(e) => patch({ customerPhone: e.target.value })}
                  className={fieldInputClass}
                  placeholder="08…"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="reservation-date"
                  className="text-xs text-muted-foreground"
                >
                  Date
                </Label>
                <Input
                  id="reservation-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => patch({ date: e.target.value })}
                  className={fieldInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Time</Label>
                <Combobox
                  options={TIME_SLOT_OPTIONS}
                  value={form.time}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, time: value || prev.time }))
                  }
                  placeholder="Select time"
                  searchPlaceholder="Search time…"
                  emptyMessage="No time found"
                  className="h-9 border-gray-200/80 focus-visible:border-primary/30 focus-visible:ring-primary/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="reservation-guests"
                className="text-xs text-muted-foreground"
              >
                Guests
              </Label>
              <Input
                id="reservation-guests"
                type="number"
                min={1}
                value={form.guestCount}
                onChange={(e) =>
                  patch({
                    guestCount: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className={fieldInputClass}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  Select table
                </Label>
                <button
                  type="button"
                  className={cn(
                    "text-xs font-medium",
                    form.tableId == null
                      ? "text-brand-text"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => patch({ tableId: null })}
                >
                  Unassigned
                </button>
              </div>
              <div className="max-h-48 space-y-3 overflow-y-auto rounded-lg border border-gray-200/70 bg-muted/20 p-2.5">
                {tableGroups.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">
                    No active tables.
                  </p>
                ) : (
                  tableGroups.map((group) => (
                    <div
                      key={group.floorKey || "__none"}
                      className="space-y-1.5"
                    >
                      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                        {group.tables.map((table) => (
                          <button
                            key={table.id}
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                tableId:
                                  prev.tableId === table.id ? null : table.id,
                              }))
                            }
                            className={cn(
                              "rounded-lg border px-2 py-1.5 text-left transition-colors",
                              form.tableId === table.id
                                ? "border-primary/30 bg-primary/10 text-brand-text"
                                : "border-gray-200/80 bg-card text-foreground hover:border-primary/20",
                            )}
                          >
                            <div className="truncate text-xs font-medium">
                              {tableDisplayName(table)}
                            </div>
                            <div className="text-[10px] opacity-70">
                              {table.capacity || 4} pax
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Order type
              </Label>
              <div className="flex gap-2">
                {ORDER_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => patch({ orderType: type.value })}
                    className={cn(
                      "flex-1",
                      chipClass(form.orderType === type.value),
                      "py-2",
                    )}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Deposit</Label>
              <div className="flex flex-wrap gap-2">
                {DEPOSIT_PRESETS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => patch({ deposit: amount })}
                    className={cn(
                      "min-w-18 flex-1",
                      chipClass(form.deposit === amount),
                      "py-2",
                    )}
                  >
                    {depositLabel(amount)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="reservation-notes"
                className="text-xs text-muted-foreground"
              >
                Notes
              </Label>
              <Textarea
                id="reservation-notes"
                value={form.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="e.g. Birthday, business meeting…"
                className="min-h-16 resize-none border-gray-200/80 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          </DialogPanelBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => onSubmit(form)}
              disabled={submitting || !isReservationFormComplete(form)}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save reservation"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <CustomerPickerDialog
        open={pickingCustomer}
        customers={customers}
        onClose={() => setPickingCustomer(false)}
        onPick={(customer) => {
          patch({
            customerId: customer?.id ?? null,
            customerName: customer?.name || "",
            customerPhone: customer?.phone ?? "",
          });
          setPickingCustomer(false);
        }}
      />
    </>
  );
}
