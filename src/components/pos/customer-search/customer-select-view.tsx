"use client";

import { Loader2, Plus, Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { CustomerWithDiscount } from "@/lib/pos-api";
import { cn } from "@/lib/utils";

const tierClass = (tier?: string) =>
  tier === "platinum"
    ? "bg-violet-100 text-violet-700"
    : tier === "gold"
      ? "bg-amber-100 text-amber-800"
      : "bg-muted text-muted-foreground";

/** Daftar customer + tombol Guest / Add customer. */
export function CustomerSelectView({
  customers,
  search,
  selectedCustomerId,
  linkingCardUid,
  linkingId,
  busy,
  showGuest,
  autoFocus,
  canCreate,
  onSearchChange,
  onGuest,
  onCreate,
  onPick,
}: {
  customers: CustomerWithDiscount[];
  search: string;
  selectedCustomerId: string | null;
  /** UID kartu yang sedang ditautkan, null bila tidak. */
  linkingCardUid: string | null;
  linkingId: string | null;
  busy: boolean;
  showGuest: boolean;
  autoFocus: boolean;
  canCreate: boolean;
  onSearchChange: (value: string) => void;
  onGuest: () => void;
  onCreate: () => void;
  onPick: (customer: CustomerWithDiscount) => void;
}) {
  return (
    <>
      {linkingCardUid ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          Linking card <span className="font-mono font-semibold text-foreground">{linkingCardUid}</span>
        </div>
      ) : null}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          aria-label="Cari customer"
          placeholder="Search by name, phone, or card ID…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus={autoFocus}
          disabled={busy}
          className="h-11 border-gray-200/80 bg-white pl-10"
        />
      </div>

      <div className={cn("grid gap-2", showGuest ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
        {showGuest ? (
          <button
            type="button"
            onClick={onGuest}
            disabled={busy}
            className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Guest</div>
              <div className="text-xs text-muted-foreground">No member discount or XP</div>
            </div>
          </button>
        ) : null}
        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10 disabled:opacity-50"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-brand-text">
              <Plus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Add customer</div>
              <div className="text-xs text-muted-foreground">Save to customer list</div>
            </div>
          </button>
        ) : null}
      </div>

      {customers.length === 0 && search.trim() && canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="w-full rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left text-sm font-semibold text-brand-text transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          No matches. Add “{search.trim()}” as a new customer
        </button>
      ) : null}

      <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-0.5">
        {customers.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => onPick(customer)}
            disabled={busy}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50",
              selectedCustomerId === customer.id
                ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5"
            )}
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-brand-text">
              {linkingId === customer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : customer.name?.charAt(0) || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{customer.name}</div>
              <div className="text-xs text-muted-foreground">
                {customer.phone}
                {customer.nfc_uid ? ` · Card ${customer.nfc_uid}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                  tierClass(customer.membership_tier)
                )}
              >
                {customer.membership_tier || "member"}
              </span>
              {customer.discount > 0 ? (
                <div className="mt-1 text-[11px] font-medium text-emerald-600">−{customer.discount}%</div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
