export type CustomerSearchView = "choice" | "select" | "create";

export function resolveCustomerSearchInitialView(input: {
  open: boolean;
  initialNfcUid?: string | null;
}): CustomerSearchView {
  if (!input.open) return "select";
  return input.initialNfcUid?.trim() ? "choice" : "select";
}

export function cardLinkConflictMessage(input: {
  existingNfcUid?: string | null;
  pendingNfcUid: string;
}): string | null {
  const existing = input.existingNfcUid?.trim().toUpperCase();
  const pending = input.pendingNfcUid.trim().toUpperCase();
  if (!existing || !pending || existing === pending) return null;
  return `Customer already has Card ${input.existingNfcUid?.trim()}. Unlink it first or pick another customer.`;
}

export function shouldShowGuestOption(input: {
  allowGuest?: boolean;
  isLinkingCard: boolean;
}): boolean {
  if (input.isLinkingCard) return false;
  return input.allowGuest !== false;
}

// ── State form modal (reducer murni) ────────────────────────────────────────

export type CustomerSearchState = {
  view: CustomerSearchView;
  name: string;
  phone: string;
  email: string;
  nfcUid: string;
  /** UID dari kartu yang dipindai: tidak bisa diubah, modal sedang menautkan kartu. */
  nfcUidLocked: boolean;
  enrollMember: boolean;
  isKol: boolean;
  formError: string;
};

export type CustomerSearchAction =
  | { type: "showSelect" }
  | { type: "openCreate"; search: string; fromChoice: boolean }
  | { type: "back" }
  | { type: "edit"; patch: Partial<Pick<CustomerSearchState, "name" | "phone" | "email" | "nfcUid" | "enrollMember" | "isKol">> }
  | { type: "error"; message: string };

/** State awal saat modal dibuka; kartu belum terdaftar → langsung pilihan tautkan/buat. */
export function initialCustomerSearchState(initialNfcUid?: string | null): CustomerSearchState {
  const uid = initialNfcUid?.trim();
  return {
    view: resolveCustomerSearchInitialView({ open: true, initialNfcUid }),
    name: "",
    phone: "",
    email: "",
    nfcUid: uid ? uid.toUpperCase() : "",
    nfcUidLocked: Boolean(uid),
    enrollMember: true,
    isKol: false,
    formError: "",
  };
}

export const isLinkingCard = (state: Pick<CustomerSearchState, "nfcUid" | "nfcUidLocked">) =>
  state.nfcUidLocked && Boolean(state.nfcUid.trim());

export function customerSearchReducer(state: CustomerSearchState, action: CustomerSearchAction): CustomerSearchState {
  switch (action.type) {
    case "showSelect":
      return { ...state, view: "select", formError: "" };
    case "openCreate": {
      const raw = action.search.trim();
      const next: CustomerSearchState = { ...state, view: "create", formError: "" };
      if (!action.fromChoice && !state.nfcUidLocked) next.nfcUid = "";
      // Teks pencarian dipakai sebagai nomor HP (angka) atau nama.
      if (/^[+\d\s-]+$/.test(raw)) next.phone = raw;
      else if (raw) next.name = raw;
      return next;
    }
    case "back":
      if (isLinkingCard(state)) return { ...state, formError: "", view: "choice", name: "", phone: "", email: "" };
      return { ...state, formError: "", view: "select" };
    case "edit":
      return { ...state, ...action.patch };
    case "error":
      return { ...state, formError: action.message };
  }
}

/** Validasi form customer baru; null = valid. */
export function createCustomerError(state: Pick<CustomerSearchState, "name" | "phone">): string | null {
  if (!state.name.trim()) return "Name is required";
  if (!state.phone.trim()) return "Phone number is required";
  return null;
}

export function customerSearchCopy(input: {
  view: CustomerSearchView;
  linkingCard: boolean;
  allowGuest: boolean;
}): { title: string; description: string } {
  const { view, linkingCard, allowGuest } = input;
  if (view === "choice") {
    return {
      title: "Card not registered",
      description: "This Card ID is not in the system yet. Link it to an existing customer or create a new one.",
    };
  }
  if (view === "create") {
    return {
      title: "Add customer",
      description: linkingCard
        ? "Create a new member and link this card."
        : "Create a walk-in customer or enroll them as a member.",
    };
  }
  if (linkingCard) {
    return { title: "Link card to customer", description: "Search and select a customer to link this card." };
  }
  return {
    title: "Select customer",
    description: allowGuest
      ? "Search members, continue as guest, or add a new customer."
      : "Search members or add a new customer.",
  };
}

/** Cari berdasarkan nama, nomor HP, atau UID kartu. */
export function filterCustomersForSearch<T extends { name?: string; phone: string; nfc_uid?: string | null }>(
  customers: T[],
  search: string
): T[] {
  const q = search.toLowerCase();
  return customers.filter(
    (c) => c.name?.toLowerCase().includes(q) || c.phone.includes(q) || (c.nfc_uid || "").toLowerCase().includes(q)
  );
}
