import { describe, expect, it } from "vitest";
import {
  cardLinkConflictMessage,
  createCustomerError,
  customerSearchCopy,
  customerSearchReducer,
  filterCustomersForSearch,
  initialCustomerSearchState,
  isLinkingCard,
  resolveCustomerSearchInitialView,
  shouldShowGuestOption,
} from "./customer-search-modal-state";

describe("resolveCustomerSearchInitialView", () => {
  it("opens choice when modal has a pending unregistered card", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: true,
        initialNfcUid: " 04aabbcc ",
      })
    ).toBe("choice");
  });

  it("opens select when opened without a card (Find customer)", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: true,
        initialNfcUid: null,
      })
    ).toBe("select");
  });

  it("stays select when closed", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: false,
        initialNfcUid: "04AABBCC",
      })
    ).toBe("select");
  });
});

describe("cardLinkConflictMessage", () => {
  it("allows linking when customer has no card", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: null,
        pendingNfcUid: "04AABBCC",
      })
    ).toBeNull();
  });

  it("allows relink when the same card is already on the customer", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: "04aabbcc",
        pendingNfcUid: "04AABBCC",
      })
    ).toBeNull();
  });

  it("blocks linking when customer already has a different card", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: "DEADBEEF",
        pendingNfcUid: "04AABBCC",
      })
    ).toMatch(/DEADBEEF/);
  });
});

describe("shouldShowGuestOption", () => {
  it("hides Guest while linking an unregistered card", () => {
    expect(shouldShowGuestOption({ allowGuest: true, isLinkingCard: true })).toBe(
      false
    );
  });

  it("hides Guest on topup even without a pending card", () => {
    expect(shouldShowGuestOption({ allowGuest: false, isLinkingCard: false })).toBe(
      false
    );
  });

  it("shows Guest on cashier Find customer", () => {
    expect(shouldShowGuestOption({ allowGuest: true, isLinkingCard: false })).toBe(
      true
    );
  });
});

describe("customerSearchReducer", () => {
  const base = initialCustomerSearchState(null);
  const card = initialCustomerSearchState(" 04aabbcc ");

  it("state awal: kartu dipindai → choice, UID terkunci & huruf besar", () => {
    expect(base).toMatchObject({ view: "select", nfcUid: "", nfcUidLocked: false, enrollMember: true });
    expect(card).toMatchObject({ view: "choice", nfcUid: "04AABBCC", nfcUidLocked: true });
    expect(isLinkingCard(card)).toBe(true);
  });

  it("buat baru: teks angka jadi HP, teks lain jadi nama; UID manual dibersihkan", () => {
    const typed = customerSearchReducer({ ...base, nfcUid: "X1" }, { type: "openCreate", search: " 0812 345 ", fromChoice: false });
    expect(typed).toMatchObject({ view: "create", phone: "0812 345", nfcUid: "" });
    const named = customerSearchReducer(base, { type: "openCreate", search: "Sari", fromChoice: false });
    expect(named).toMatchObject({ name: "Sari", phone: "" });
    const fromCard = customerSearchReducer(card, { type: "openCreate", search: "", fromChoice: true });
    expect(fromCard.nfcUid).toBe("04AABBCC");
  });

  it("kembali: saat menautkan kartu ke choice dan kosongkan isian", () => {
    const creating = customerSearchReducer(card, { type: "edit", patch: { name: "A", phone: "1" } });
    expect(customerSearchReducer({ ...creating, view: "create" }, { type: "back" })).toMatchObject({
      view: "choice",
      name: "",
      phone: "",
    });
    expect(customerSearchReducer({ ...base, view: "create", formError: "x" }, { type: "back" })).toMatchObject({
      view: "select",
      formError: "",
    });
  });

  it("validasi & teks judul", () => {
    expect(createCustomerError({ name: " ", phone: "1" })).toBe("Name is required");
    expect(createCustomerError({ name: "A", phone: "" })).toBe("Phone number is required");
    expect(createCustomerError({ name: "A", phone: "1" })).toBeNull();
    expect(customerSearchCopy({ view: "select", linkingCard: true, allowGuest: true }).title).toBe("Link card to customer");
    expect(customerSearchCopy({ view: "select", linkingCard: false, allowGuest: false }).description).toBe(
      "Search members or add a new customer."
    );
  });

  it("filter nama/HP/kartu", () => {
    const list = [
      { name: "Ana", phone: "0811", nfc_uid: "04AA" },
      { name: "Budi", phone: "0822", nfc_uid: null },
    ];
    expect(filterCustomersForSearch(list, "04aa").map((c) => c.name)).toEqual(["Ana"]);
    expect(filterCustomersForSearch(list, "082").map((c) => c.name)).toEqual(["Budi"]);
  });
});
