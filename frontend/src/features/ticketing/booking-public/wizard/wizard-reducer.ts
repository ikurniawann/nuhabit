// State machine wizard booking publik: pilih → pemesan → ringkasan.
// Aturan keranjang (1 produk / transaksi, maks orang) ada di
// @/lib/ticketing/booking-wizard-cart; reducer ini hanya merangkai state.

import {
  applyQtyChange,
  type CatalogProduct,
  type CatalogVariant,
  type QtyMap,
} from "@/lib/ticketing/booking-wizard-cart";

export const STEP_ORDER = ["pilih", "pemesan", "ringkasan"] as const;
export type WizardStep = (typeof STEP_ORDER)[number];

export interface AppliedPromo {
  code: string;
  discount: number;
  campaign_name: string;
}

export interface WizardState {
  step: WizardStep;
  visitDate: string;
  calendarOpen: boolean;
  /** 1 transaksi = 1 produk tiket; qty diisi per varian produk terpilih. */
  selectedProductId: string | null;
  qty: QtyMap;
  /** EPIC-031 D: wajib dipilih bila venue punya slot jam. */
  selectedSlotId: string | null;
  customerName: string;
  customerPhone: string;
  /** Nama anggota per varian per unit ORANG (kosong = default server). */
  guestNames: Record<string, string[]>;
  /** EPIC-032 D2: e-tiket dikirim ke WA penerima hadiah. */
  isGift: boolean;
  giftName: string;
  giftPhone: string;
  /** EPIC-032 B2: kode promo, preview indikatif via /promo-check. */
  promoInput: string;
  promo: AppliedPromo | null;
  promoError: string | null;
}

export type TextField = "customerName" | "customerPhone" | "giftName" | "giftPhone";

export type WizardAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "toggleCalendar" }
  | { type: "pickDate"; date: string }
  | { type: "changeQty"; product: CatalogProduct; variant: CatalogVariant; delta: number }
  | { type: "selectSlot"; slotId: string }
  | { type: "setText"; field: TextField; value: string }
  | { type: "setGift"; isGift: boolean }
  | { type: "setGuestName"; variantId: string; unitIndex: number; value: string }
  | { type: "setPromoInput"; value: string }
  | { type: "promoApplied"; promo: AppliedPromo }
  | { type: "promoRejected"; message: string }
  | { type: "clearPromo" };

export const initialWizardState = (visitDate: string): WizardState => ({
  step: "pilih",
  visitDate,
  calendarOpen: false,
  selectedProductId: null,
  qty: {},
  selectedSlotId: null,
  customerName: "",
  customerPhone: "",
  guestNames: {},
  isGift: false,
  giftName: "",
  giftPhone: "",
  promoInput: "",
  promo: null,
  promoError: null,
});

const stepAt = (state: WizardState, offset: number): WizardStep => {
  const index = STEP_ORDER.indexOf(state.step) + offset;
  return STEP_ORDER[Math.min(STEP_ORDER.length - 1, Math.max(0, index))];
};

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "next":
      return { ...state, step: stepAt(state, 1) };
    case "back":
      return { ...state, step: stepAt(state, -1) };
    case "toggleCalendar":
      return { ...state, calendarOpen: !state.calendarOpen };
    case "pickDate":
      // Harga, kuota & slot per tanggal: buang pilihan dan potongan lama
      return {
        ...state,
        visitDate: action.date,
        calendarOpen: false,
        selectedProductId: null,
        qty: {},
        guestNames: {},
        selectedSlotId: null,
        promo: null,
        promoError: null,
      };
    case "changeQty": {
      const current = { selectedProductId: state.selectedProductId, qty: state.qty };
      const next = applyQtyChange(current, action.product, action.variant, action.delta);
      if (next === current) return state;
      const switched = next.selectedProductId !== state.selectedProductId;
      // Subtotal berubah → potongan promo lama tidak valid lagi
      return {
        ...state,
        ...next,
        guestNames: switched ? {} : state.guestNames,
        promo: null,
        promoError: null,
      };
    }
    case "selectSlot":
      return { ...state, selectedSlotId: action.slotId };
    case "setText":
      return { ...state, [action.field]: action.value };
    case "setGift":
      return action.isGift
        ? { ...state, isGift: true }
        : { ...state, isGift: false, giftName: "", giftPhone: "" };
    case "setGuestName": {
      const names = [...(state.guestNames[action.variantId] ?? [])];
      names[action.unitIndex] = action.value;
      return { ...state, guestNames: { ...state.guestNames, [action.variantId]: names } };
    }
    case "setPromoInput":
      return { ...state, promoInput: action.value.toUpperCase(), promoError: null };
    case "promoApplied":
      return { ...state, promo: action.promo, promoInput: "", promoError: null };
    case "promoRejected":
      return { ...state, promo: null, promoError: action.message };
    case "clearPromo":
      return { ...state, promo: null, promoError: null };
  }
}
