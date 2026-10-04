"use client";

import { useState } from "react";
import { Search, User } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { filterCustomers } from "../reservation-rules";
import type { ReservationCustomer } from "../types";

/** Cari customer untuk form reservasi; null = tamu baru (isi manual). */
export function CustomerPickerDialog({
  open,
  customers,
  onPick,
  onClose,
}: {
  open: boolean;
  customers: ReservationCustomer[];
  onPick: (customer: ReservationCustomer | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const pick = (customer: ReservationCustomer | null) => {
    setSearch("");
    onPick(customer);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Find customer</DialogPanelTitle>
          <DialogPanelDescription>Search by name or phone, or continue as a new guest.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Cari customer"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or phone…"
              autoFocus
              className="h-9 border-gray-200/80 pl-9 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => pick(null)}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-gray-200/70 hover:bg-muted/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">New guest</div>
                <div className="text-xs text-muted-foreground">Enter name and phone on the form</div>
              </div>
            </button>
            {filterCustomers(customers, search).map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => pick(customer)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-primary/20 hover:bg-primary/5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-sm font-semibold text-brand-text">{(customer.name || customer.phone).charAt(0)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{customer.name || "Guest"}</div>
                  <div className="text-xs text-muted-foreground">{customer.phone}</div>
                </div>
                <div className="text-xs text-muted-foreground">{customer.visit_count || 0}×</div>
              </button>
            ))}
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-gray-200/80" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
