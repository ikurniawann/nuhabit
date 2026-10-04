"use client";

import { Input } from "@/components/ui/input";
import type { CustomerSearchAction, CustomerSearchState } from "../customer-search-modal-state";

type Edit = Extract<CustomerSearchAction, { type: "edit" }>["patch"];

/** Form customer baru (opsional menautkan kartu yang dipindai). */
export function CreateCustomerForm({
  state,
  busy,
  autoFocus,
  onEdit,
}: {
  state: CustomerSearchState;
  busy: boolean;
  autoFocus: boolean;
  onEdit: (patch: Edit) => void;
}) {
  return (
    <div className="space-y-4">
      {state.formError ? (
        <div className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {state.formError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">
            Name <span className="text-red-500">*</span>
          </span>
          <Input
            value={state.name}
            onChange={(e) => onEdit({ name: e.target.value })}
            autoFocus={autoFocus}
            placeholder="Customer name"
            disabled={busy}
            required
            className="border-gray-200/80"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">
            Phone <span className="text-red-500">*</span>
          </span>
          <Input
            value={state.phone}
            onChange={(e) => onEdit({ phone: e.target.value })}
            placeholder="08xxxxxxxxxx"
            disabled={busy}
            required
            className="border-gray-200/80"
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">
          Card ID {!state.nfcUidLocked ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
        </span>
        <Input
          value={state.nfcUid}
          onChange={(e) => onEdit({ nfcUid: e.target.value.toUpperCase() })}
          placeholder="NFC / RFID UID"
          disabled={busy || state.nfcUidLocked}
          readOnly={state.nfcUidLocked}
          className="border-gray-200/80 font-mono tracking-wide"
        />
        {state.nfcUidLocked ? (
          <span className="text-xs text-muted-foreground">
            Filled from the scanned card. Save to link this card to the member.
          </span>
        ) : null}
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">
          Email <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Input
          value={state.email}
          onChange={(e) => onEdit({ email: e.target.value })}
          placeholder="email@domain.com"
          disabled={busy}
          className="border-gray-200/80"
        />
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
        <input
          type="checkbox"
          checked={state.enrollMember}
          onChange={(e) => onEdit({ enrollMember: e.target.checked })}
          disabled={busy}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <span>
          <span className="block text-sm font-semibold text-foreground">Enroll as member</span>
          <span className="block text-xs text-muted-foreground">Enables membership benefits and XP on purchases.</span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3.5">
        <input
          type="checkbox"
          checked={state.isKol}
          onChange={(e) => onEdit({ isKol: e.target.checked })}
          disabled={busy}
          className="mt-0.5 h-4 w-4 accent-amber-600"
        />
        <span>
          <span className="block text-sm font-semibold text-foreground">KOL (komplimen gratis)</span>
          <span className="block text-xs text-muted-foreground">
            Order customer ini bisa digratiskan &amp; tercatat sebagai komplimen KOL. Kuota bulanan diatur di CRM &rarr;
            Members.
          </span>
        </span>
      </label>
    </div>
  );
}
