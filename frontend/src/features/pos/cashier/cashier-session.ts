/**
 * State machine sesi checkout kasir (murni, tanpa React): modal bayar,
 * tender terakhir, open bill yang sedang dibayar, langkah handoff dari URL,
 * kode promo, struk hasil bayar, dan kembali ke Restaurant setelah struk.
 * Isi keranjang sendiri hidup di usePosCart.
 */

import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import type { CfdPayment } from "@/lib/pos/cfd";

/** offerRuleId terisi = kode pembuka penawaran (diskonnya lewat offerEval). */
export interface AppliedPromo {
  code: string;
  discount: number;
  offerRuleId?: string;
}

export interface GiftCardBuyer {
  name: string | null;
  phone: string | null;
}

export type ResultKind = "standard" | "offlined";

export interface CashierSessionState {
  paymentOpen: boolean;
  processing: boolean;
  savingBill: boolean;
  /** Tender terakhir yang dikonfirmasi; dipakai pratinjau ARK di keranjang. */
  tender: { method: string; arkToUse: number };
  /** Open bill (order/checkout) yang dimuat dari URL. */
  bill: { key: string | null; number: string | null; persistedItemIds: string[] };
  handoff: { freshResetDone: boolean; autoPayDone: boolean; restaurantKey: string | null };
  /** `basis` = subtotal item + customer saat promo terakhir valid. */
  promo: {
    applied: AppliedPromo | null;
    input: string;
    busy: boolean;
    error: string | null;
    basis: string | null;
  };
  giftCardBuyer: GiftCardBuyer | null;
  cfdPayment: CfdPayment | null;
  result: { payload: ReceiptPayload; kind: ResultKind; waPhone: string } | null;
  /** Dari Restaurant: kembali ke board setelah dialog struk ditutup. */
  returnAfterResult: boolean;
}

export type CashierSessionAction =
  | { type: "paymentOpened" }
  | { type: "paymentClosed" }
  | { type: "tenderChosen"; method: string; arkToUse: number }
  | { type: "processingChanged"; processing: boolean }
  | { type: "paymentSucceeded"; clearBill: boolean; returnToRestaurant: boolean }
  | { type: "resultRevealed"; payload: ReceiptPayload; kind: ResultKind; waPhone: string }
  | { type: "resultClosed" }
  | { type: "billLoaded"; key: string; number: string | null; persistedItemIds?: string[] }
  | { type: "freshReset" }
  | { type: "autoPayApplied" }
  | { type: "restaurantHandoffApplied"; key: string }
  | { type: "savingBillChanged"; saving: boolean }
  | { type: "openBillSaved"; appendedItemIds: string[] | null }
  | { type: "promoInputChanged"; value: string }
  | { type: "promoCheckStarted" }
  | { type: "promoRejected"; error: string }
  | { type: "promoApplied"; promo: AppliedPromo }
  | { type: "promoCheckFinished" }
  | { type: "promoCleared" }
  | { type: "promoBasisChanged"; basis: string }
  | { type: "cartCleared" }
  | { type: "giftCardBuyerSet"; buyer: GiftCardBuyer | null }
  | { type: "cfdPaymentChanged"; payment: CfdPayment | null };

const CASH_TENDER = { method: "cash", arkToUse: 0 };

export function initialCashierSession(): CashierSessionState {
  return {
    paymentOpen: false,
    processing: false,
    savingBill: false,
    tender: CASH_TENDER,
    bill: { key: null, number: null, persistedItemIds: [] },
    handoff: { freshResetDone: false, autoPayDone: false, restaurantKey: null },
    promo: { applied: null, input: "", busy: false, error: null, basis: null },
    giftCardBuyer: null,
    cfdPayment: null,
    result: null,
    returnAfterResult: false,
  };
}

/** Basis promo: berubah bila subtotal item atau customer berubah. */
export function promoBasis(itemsSubtotal: number, customerId: string | null): string {
  return `${itemsSubtotal}|${customerId ?? ""}`;
}

export function cashierSessionReducer(
  state: CashierSessionState,
  action: CashierSessionAction
): CashierSessionState {
  switch (action.type) {
    case "paymentOpened":
      return { ...state, paymentOpen: true };
    case "paymentClosed":
      return { ...state, paymentOpen: false };
    case "tenderChosen":
      return { ...state, tender: { method: action.method, arkToUse: action.arkToUse } };
    case "processingChanged":
      return { ...state, processing: action.processing };
    case "paymentSucceeded":
      return {
        ...state,
        paymentOpen: false,
        tender: CASH_TENDER,
        bill: action.clearBill ? { ...state.bill, key: null } : state.bill,
        returnAfterResult: state.returnAfterResult || action.returnToRestaurant,
      };
    case "resultRevealed":
      return {
        ...state,
        result: { payload: action.payload, kind: action.kind, waPhone: action.waPhone },
      };
    case "resultClosed":
      return { ...state, result: null, returnAfterResult: false };
    case "billLoaded":
      return {
        ...state,
        tender: { ...state.tender, method: "cash" },
        bill: {
          key: action.key,
          number: action.number,
          persistedItemIds: action.persistedItemIds ?? state.bill.persistedItemIds,
        },
      };
    case "freshReset":
      return {
        ...state,
        bill: { key: null, number: null, persistedItemIds: [] },
        handoff: { ...state.handoff, freshResetDone: true },
      };
    case "autoPayApplied":
      return { ...state, paymentOpen: true, handoff: { ...state.handoff, autoPayDone: true } };
    case "restaurantHandoffApplied":
      return { ...state, handoff: { ...state.handoff, restaurantKey: action.key } };
    case "savingBillChanged":
      return { ...state, savingBill: action.saving };
    case "openBillSaved":
      return {
        ...state,
        bill: {
          ...state.bill,
          persistedItemIds: action.appendedItemIds
            ? [...state.bill.persistedItemIds, ...action.appendedItemIds]
            : [],
        },
      };
    case "promoInputChanged":
      return {
        ...state,
        promo: { ...state.promo, input: action.value.toUpperCase(), error: null },
      };
    case "promoCheckStarted":
      return { ...state, promo: { ...state.promo, busy: true, error: null } };
    case "promoRejected":
      return { ...state, promo: { ...state.promo, error: action.error } };
    case "promoApplied":
      return { ...state, promo: { ...state.promo, applied: action.promo, input: "" } };
    case "promoCheckFinished":
      return { ...state, promo: { ...state.promo, busy: false } };
    case "promoCleared":
      return { ...state, promo: { ...state.promo, applied: null, error: null } };
    case "promoBasisChanged":
      // Promo basi saat subtotal item / customer berubah: preview server tak berlaku.
      return {
        ...state,
        promo: { ...state.promo, applied: null, error: null, basis: action.basis },
      };
    case "cartCleared":
      return { ...state, promo: { ...state.promo, applied: null, error: null, input: "" } };
    case "giftCardBuyerSet":
      return { ...state, giftCardBuyer: action.buyer };
    case "cfdPaymentChanged":
      return { ...state, cfdPayment: action.payment };
    default:
      return state;
  }
}
