"use client";

import { useReducer, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CustomerWithDiscount } from "@/lib/pos-api";
import { prefersInputAutoFocus } from "@/lib/pos/input-autofocus";
import {
  cardLinkConflictMessage,
  createCustomerError,
  customerSearchCopy,
  customerSearchReducer,
  filterCustomersForSearch,
  initialCustomerSearchState,
  isLinkingCard,
  shouldShowGuestOption,
} from "./customer-search-modal-state";
import { CardChoiceView } from "./customer-search/card-choice-view";
import { CreateCustomerForm } from "./customer-search/create-customer-form";
import { CustomerSelectView } from "./customer-search/customer-select-view";

export type CreateCustomerPayload = {
  name: string;
  phone: string;
  email?: string;
  enroll_member: boolean;
  nfc_uid?: string;
  /** EPIC-043 — tandai customer sebagai KOL (komplimen gratis di kasir). */
  is_kol?: boolean;
};

interface Props {
  open: boolean;
  customers: CustomerWithDiscount[];
  search: string;
  selectedCustomerId: string | null;
  onSearchChange: (v: string) => void;
  onSelect: (customer: CustomerWithDiscount | null) => void;
  onCreateCustomer?: (payload: CreateCustomerPayload) => Promise<CustomerWithDiscount>;
  onClose: () => void;
  /** Prefill Card ID for unknown NFC scan — shows choice to link existing or create. */
  initialNfcUid?: string | null;
  /** Hide Guest (top-up wallet needs a real customer). Default true for cashier. */
  allowGuest?: boolean;
  /** @deprecated UID is no longer cleared by the modal on open. */
  onInitialNfcUidConsumed?: () => void;
}

type BodyProps = Omit<Props, "open" | "onInitialNfcUidConsumed" | "allowGuest"> & { allowGuest: boolean };

export function CustomerSearchModal({ open, initialNfcUid = null, allowGuest = true, ...rest }: Props) {
  // Isi modal di-mount ulang tiap dibuka (atau UID kartu berubah), jadi state selalu mulai bersih.
  return (
    <Dialog open={open} onOpenChange={(next) => !next && rest.onClose()}>
      {open ? (
        <CustomerSearchBody
          key={initialNfcUid ?? ""}
          {...rest}
          initialNfcUid={initialNfcUid}
          allowGuest={allowGuest}
        />
      ) : null}
    </Dialog>
  );
}

function CustomerSearchBody({
  customers,
  search,
  selectedCustomerId,
  onSearchChange,
  onSelect,
  onCreateCustomer,
  initialNfcUid,
  allowGuest,
}: BodyProps) {
  const [state, dispatch] = useReducer(customerSearchReducer, initialNfcUid, initialCustomerSearchState);
  const [saving, setSaving] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  // Tablet/HP (owner 2026-10-01): jangan fokus otomatis → keyboard virtual
  // tidak langsung muncul menutupi daftar. Desktop (mouse) tetap fokus.
  const [autoFocusInputs] = useState(prefersInputAutoFocus);

  const linkingCard = isLinkingCard(state);
  const busy = saving || linkingId !== null;
  const { view } = state;
  const copy = customerSearchCopy({ view, linkingCard, allowGuest });
  const pendingUid = state.nfcUid.trim().toUpperCase();

  function finish(customer: CustomerWithDiscount) {
    onSearchChange("");
    onSelect(customer);
  }

  async function handleCreate() {
    if (!onCreateCustomer) return;
    const invalid = createCustomerError(state);
    if (invalid) {
      dispatch({ type: "error", message: invalid });
      return;
    }
    try {
      setSaving(true);
      dispatch({ type: "error", message: "" });
      finish(
        await onCreateCustomer({
          name: state.name.trim(),
          phone: state.phone.trim(),
          email: state.email.trim() || undefined,
          enroll_member: state.enrollMember,
          nfc_uid: pendingUid || undefined,
          is_kol: state.isKol,
        })
      );
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Failed to save customer" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePick(customer: CustomerWithDiscount) {
    if (!linkingCard) {
      onSelect(customer);
      return;
    }
    if (!onCreateCustomer) {
      dispatch({ type: "error", message: "Cannot link card — save handler missing" });
      return;
    }
    const conflict = cardLinkConflictMessage({ existingNfcUid: customer.nfc_uid, pendingNfcUid: state.nfcUid });
    if (conflict) {
      dispatch({ type: "error", message: conflict });
      return;
    }
    try {
      setLinkingId(customer.id);
      dispatch({ type: "error", message: "" });
      finish(
        await onCreateCustomer({
          name: customer.name || "",
          phone: customer.phone,
          email: customer.email || undefined,
          enroll_member: true,
          nfc_uid: pendingUid,
        })
      );
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Failed to link card to customer" });
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <DialogPanel size="lg">
      <DialogPanelHeader>
        <DialogPanelTitle>{copy.title}</DialogPanelTitle>
        <DialogPanelDescription>{copy.description}</DialogPanelDescription>
      </DialogPanelHeader>

      <DialogPanelBody className="space-y-4">
        {state.formError && view !== "create" ? (
          <div className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {state.formError}
          </div>
        ) : null}

        {view === "choice" ? (
          <CardChoiceView
            nfcUid={state.nfcUid}
            onPickExisting={() => dispatch({ type: "showSelect" })}
            onCreateNew={() => dispatch({ type: "openCreate", search, fromChoice: true })}
          />
        ) : null}

        {view === "select" ? (
          <CustomerSelectView
            customers={filterCustomersForSearch(customers, search)}
            search={search}
            selectedCustomerId={selectedCustomerId}
            linkingCardUid={linkingCard ? state.nfcUid : null}
            linkingId={linkingId}
            busy={busy}
            showGuest={shouldShowGuestOption({ allowGuest, isLinkingCard: linkingCard })}
            autoFocus={autoFocusInputs}
            canCreate={Boolean(onCreateCustomer)}
            onSearchChange={onSearchChange}
            onGuest={() => onSelect(null)}
            onCreate={() => dispatch({ type: "openCreate", search, fromChoice: linkingCard })}
            onPick={(customer) => void handlePick(customer)}
          />
        ) : null}

        {view === "create" ? (
          <CreateCustomerForm
            state={state}
            busy={busy}
            autoFocus={autoFocusInputs}
            onEdit={(patch) => dispatch({ type: "edit", patch })}
          />
        ) : null}
      </DialogPanelBody>

      {view === "create" || (view === "select" && linkingCard) ? (
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={() => dispatch({ type: "back" })}
            disabled={busy}
          >
            Back
          </Button>
          {view === "create" ? (
            <Button type="button" onClick={() => void handleCreate()} disabled={busy} className="bg-primary hover:bg-primary/90">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save & select"
              )}
            </Button>
          ) : null}
        </DialogFooter>
      ) : null}
    </DialogPanel>
  );
}
