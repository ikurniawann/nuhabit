"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Nfc, Plus, Search, User, UserPlus, Users } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import type { CustomerWithDiscount } from "@/hooks/use-pos-customers";
import { cn } from "@/lib/utils";
import { prefersInputAutoFocus } from "@/lib/pos/input-autofocus";
import {
  cardLinkConflictMessage,
  resolveCustomerSearchInitialView,
  shouldShowGuestOption,
  type CustomerSearchView,
} from "./customer-search-modal-state";

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

export function CustomerSearchModal({
  open,
  customers,
  search,
  selectedCustomerId,
  onSearchChange,
  onSelect,
  onCreateCustomer,
  onClose,
  initialNfcUid = null,
  allowGuest = true,
}: Props) {
  const [view, setView] = useState<CustomerSearchView>("select");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Tablet/HP (owner 2026-10-01): jangan fokus otomatis → keyboard virtual
  // tidak langsung muncul menutupi daftar. Desktop (mouse) tetap fokus.
  const autoFocusInputs = useMemo(() => prefersInputAutoFocus(), []);
  const [nfcUid, setNfcUid] = useState("");
  const [nfcUidLocked, setNfcUidLocked] = useState(false);
  const [enrollMember, setEnrollMember] = useState(true);
  const [isKol, setIsKol] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  const isLinkingCard = nfcUidLocked && Boolean(nfcUid.trim());
  const showGuest = shouldShowGuestOption({ allowGuest, isLinkingCard });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.nfc_uid || "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  const resetAll = () => {
    setView("select");
    setName("");
    setPhone("");
    setEmail("");
    setNfcUid("");
    setNfcUidLocked(false);
    setEnrollMember(true);
    setIsKol(false);
    setFormError("");
    setSaving(false);
    setLinkingId(null);
  };

  useEffect(() => {
    if (!open) {
      resetAll();
      return;
    }

    const uid = initialNfcUid?.trim();
    const nextView = resolveCustomerSearchInitialView({ open, initialNfcUid });
    setView(nextView);
    setFormError("");
    setSaving(false);
    setLinkingId(null);

    if (uid) {
      setNfcUid(uid.toUpperCase());
      setNfcUidLocked(true);
      setEnrollMember(true);
      setName("");
      setPhone("");
      setEmail("");
      return;
    }

    setNfcUid("");
    setNfcUidLocked(false);
  }, [open, initialNfcUid]);

  const openCreateForm = (fromChoice = false) => {
    const raw = search.trim();
    setView("create");
    setFormError("");
    if (!fromChoice && !nfcUidLocked) {
      setNfcUidLocked(false);
      setNfcUid("");
    }
    if (/^[+\d\s-]+$/.test(raw)) setPhone(raw);
    else if (raw) setName(raw);
  };

  const goBackFromCreateOrSelect = () => {
    setFormError("");
    setLinkingId(null);
    if (isLinkingCard) {
      setView("choice");
      setName("");
      setPhone("");
      setEmail("");
      return;
    }
    setView("select");
  };

  const handleCreate = async () => {
    if (!onCreateCustomer) return;
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanNfcUid = nfcUid.trim().toUpperCase();

    if (!cleanName) {
      setFormError("Name is required");
      return;
    }

    if (!cleanPhone) {
      setFormError("Phone number is required");
      return;
    }

    try {
      setSaving(true);
      setFormError("");
      const customer = await onCreateCustomer({
        name: cleanName,
        phone: cleanPhone,
        email: email.trim() || undefined,
        enroll_member: enrollMember,
        nfc_uid: cleanNfcUid || undefined,
        is_kol: isKol,
      });
      resetAll();
      onSearchChange("");
      onSelect(customer);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to save customer"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSelectExisting = async (customer: CustomerWithDiscount) => {
    if (!isLinkingCard) {
      onSelect(customer);
      return;
    }

    if (!onCreateCustomer) {
      setFormError("Cannot link card — save handler missing");
      return;
    }

    const conflict = cardLinkConflictMessage({
      existingNfcUid: customer.nfc_uid,
      pendingNfcUid: nfcUid,
    });
    if (conflict) {
      setFormError(conflict);
      return;
    }

    try {
      setLinkingId(customer.id);
      setFormError("");
      const linked = await onCreateCustomer({
        name: customer.name || "",
        phone: customer.phone,
        email: customer.email || undefined,
        enroll_member: true,
        nfc_uid: nfcUid.trim().toUpperCase(),
      });
      resetAll();
      onSearchChange("");
      onSelect(linked);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to link card to customer"
      );
    } finally {
      setLinkingId(null);
    }
  };

  const title =
    view === "choice"
      ? "Card not registered"
      : view === "create"
        ? "Add customer"
        : isLinkingCard
          ? "Link card to customer"
          : "Select customer";

  const description =
    view === "choice"
      ? "This Card ID is not in the system yet. Link it to an existing customer or create a new one."
      : view === "create"
        ? isLinkingCard
          ? "Create a new member and link this card."
          : "Create a walk-in customer or enroll them as a member."
        : isLinkingCard
          ? "Search and select a customer to link this card."
          : allowGuest
            ? "Search members, continue as guest, or add a new customer."
            : "Search members or add a new customer.";

  const busy = saving || linkingId !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          resetAll();
          onClose();
        }
      }}
    >
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>{description}</DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-4">
          {formError && view !== "create" ? (
            <div className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {formError}
            </div>
          ) : null}

          {view === "choice" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200/70 bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Nfc className="h-3.5 w-3.5" />
                  Card ID
                </div>
                <div className="mt-1 font-mono text-base font-semibold tracking-wide text-foreground">
                  {nfcUid}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError("");
                    setView("select");
                  }}
                  className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      Pilih customer yang sudah ada
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Link kartu ke member existing
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => openCreateForm(true)}
                  className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <UserPlus className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      Buat customer baru
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Daftar member baru + link kartu
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : null}

          {view === "select" ? (
            <>
              {isLinkingCard ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  Linking card{" "}
                  <span className="font-mono font-semibold text-foreground">{nfcUid}</span>
                </div>
              ) : null}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by name, phone, or card ID…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  autoFocus={autoFocusInputs}
                  disabled={busy}
                  className="h-11 border-gray-200/80 bg-white pl-10"
                />
              </div>

              <div className={cn("grid gap-2", showGuest ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
                {showGuest ? (
                  <button
                    type="button"
                    onClick={() => onSelect(null)}
                    disabled={busy}
                    className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">Guest</div>
                      <div className="text-xs text-muted-foreground">
                        No member discount or XP
                      </div>
                    </div>
                  </button>
                ) : null}
                {onCreateCustomer ? (
                  <button
                    type="button"
                    onClick={() => openCreateForm(isLinkingCard)}
                    disabled={busy}
                    className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10 disabled:opacity-50"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">Add customer</div>
                      <div className="text-xs text-muted-foreground">Save to customer list</div>
                    </div>
                  </button>
                ) : null}
              </div>

              {filtered.length === 0 && search.trim() && onCreateCustomer ? (
                <button
                  type="button"
                  onClick={() => openCreateForm(isLinkingCard)}
                  disabled={busy}
                  className="w-full rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  No matches. Add “{search.trim()}” as a new customer
                </button>
              ) : null}

              <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-0.5">
                {filtered.map((customer) => {
                  const selected = selectedCustomerId === customer.id;
                  const isRowLinking = linkingId === customer.id;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => void handleSelectExisting(customer)}
                      disabled={busy}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50",
                        selected
                          ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                          : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5"
                      )}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {isRowLinking ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          customer.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {customer.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {customer.phone}
                          {customer.nfc_uid ? ` · Card ${customer.nfc_uid}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            customer.membership_tier === "platinum"
                              ? "bg-violet-100 text-violet-700"
                              : customer.membership_tier === "gold"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {customer.membership_tier || "member"}
                        </span>
                        {customer.discount > 0 ? (
                          <div className="mt-1 text-[11px] font-medium text-emerald-600">
                            −{customer.discount}%
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {view === "create" ? (
            <div className="space-y-4">
              {formError ? (
                <div className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {formError}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Name <span className="text-red-500">*</span>
                  </span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus={autoFocusInputs}
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    disabled={busy}
                    required
                    className="border-gray-200/80"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  Card ID{" "}
                  {!nfcUidLocked ? (
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  ) : null}
                </span>
                <Input
                  value={nfcUid}
                  onChange={(e) => setNfcUid(e.target.value.toUpperCase())}
                  placeholder="NFC / RFID UID"
                  disabled={busy || nfcUidLocked}
                  readOnly={nfcUidLocked}
                  className="border-gray-200/80 font-mono tracking-wide"
                />
                {nfcUidLocked ? (
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@domain.com"
                  disabled={busy}
                  className="border-gray-200/80"
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <input
                  type="checkbox"
                  checked={enrollMember}
                  onChange={(e) => setEnrollMember(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    Enroll as member
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Enables membership benefits and XP on purchases.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3.5">
                <input
                  type="checkbox"
                  checked={isKol}
                  onChange={(e) => setIsKol(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    KOL (komplimen gratis)
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Order customer ini bisa digratiskan &amp; tercatat sebagai komplimen KOL.
                    Kuota bulanan diatur di CRM &rarr; Members.
                  </span>
                </span>
              </label>
            </div>
          ) : null}
        </DialogPanelBody>

        {view === "create" || (view === "select" && isLinkingCard) ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={goBackFromCreateOrSelect}
              disabled={busy}
            >
              Back
            </Button>
            {view === "create" ? (
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={busy}
                className="bg-primary hover:bg-primary/90"
              >
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
    </Dialog>
  );
}
