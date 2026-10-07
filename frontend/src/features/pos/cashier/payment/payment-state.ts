import { parseIdrDigits } from "@/components/pos/idr-input";
import {
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  mixedQrisCheckoutIdForAmount,
  shouldSkipQrisPrepare,
  shouldStopQrisAutoRetry,
} from "@/lib/pos/central-cashier";
import {
  cashierMethodFromHandler,
  DEFAULT_POS_PAYMENT_METHODS,
  type PosPaymentMethod,
} from "@/lib/pos/payment-methods";

export type PaymentMethod =
  | "cash"
  | "qris"
  | "credit_card"
  | "ark_coin"
  | "nfc_tab"
  | "gift_card"
  // Metode kustom buatan admin (master Metode Bayar) — alur generik
  | (string & {});

/** Hasil pratinjau tab ticketing (EPIC-023 Fase C) utk metode NFC Tab. */
export interface NfcTabCheckResult {
  ok: boolean;
  reason?: string;
  contactName?: string;
  paymentMode?: "postpaid" | "prepaid";
  available?: number | null;
}

/**
 * Hasil pratinjau gift card (EPIC-034 Fase C). INDIKATIF — saldo final tetap
 * ditegakkan server saat debit ber-lock.
 */
export interface GiftCardCheckResult {
  ok: boolean;
  reason?: string;
  balance?: number;
  /** Saldo menutup SELURUH total (keputusan owner: full-cover only). */
  covers?: boolean;
  expiresAt?: string | null;
}

export interface PaymentConfirmPayload {
  method: PaymentMethod;
  cashReceived: string;
  arkToUse: number;
  /** UID gelang ticketing — terisi saat method 'nfc_tab' */
  nfcTabUid?: string;
  /** Kode gift card — terisi saat method 'gift_card' (EPIC-034 Fase C) */
  giftCardCode?: string;
  checkoutId?: string;
  checkoutNumber?: string;
  queueNumber?: string | null;
  /**
   * Bug #5 fix (insiden 2026-08-25) — order 'unpaid' yang disiapkan oleh
   * onPrepareOrderQris utk jual instan QRIS; kasir-page menyelesaikannya
   * lewat jalur "bayar open bill" yang sama seperti payingOrderId.
   */
  orderId?: string;
  orderNumber?: string;
  xenditQrId?: string;
  xenditExternalId?: string;
  paymentMethodCode?: string;
  paymentMethodName?: string;
  /** PIN supervisor — terisi saat metode FOC (diverifikasi ulang server). */
  supervisorPin?: string;
}

export interface PaymentCustomer {
  id: string;
  name?: string;
  ark_coin_balance: number;
}

/** QRIS dinamis (EPIC-024) — QR per transaksi ber-nominal terkunci. */
export interface QrisCode {
  amount: number;
  qr_string: string;
  qr_id: string;
  reference_id?: string;
  merchant_name?: string | null;
  nmid?: string | null;
}

/**
 * Siklus QRIS. "Menyiapkan" tidak disimpan: QR sedang dibuat selama status
 * `idle` dan QRIS aktif (lihat qrisNeedsPrepare), jadi effect pembuat QR tidak
 * perlu men-set state di awal.
 * - paid: Xendit bilang lunas, settle ke server sedang berjalan.
 * - settle_error: Bug #3 fix (insiden 2026-08-25) — Xendit sudah lunas tapi
 *   server terus menolak (mis. 409 nominal berubah). Auto-retry berhenti,
 *   kasir lanjut lewat tombol "Coba lagi".
 */
export type QrisState =
  | { status: "idle" }
  | { status: "ready"; qr: QrisCode }
  | { status: "paid"; qr: QrisCode }
  | { status: "settle_error"; qr: QrisCode; message: string }
  | { status: "unavailable"; error: string };

export interface PreparedCheckout {
  checkout_id: string;
  checkout_number?: string;
  queue_number?: string | null;
  /** Nominal saat checkout disiapkan; beda nominal = checkout basi. */
  amount: number;
}

/**
 * Bug #5 fix (insiden 2026-08-25): order 'unpaid' yang dibuat via
 * onPrepareOrderQris sebelum QR jual-instan dimunculkan.
 */
export interface PreparedOrder {
  order_id: string;
  order_number?: string;
  queue_number?: string | null;
}

/** Checkout/order 'unpaid' yang harus dibatalkan oleh effect QRIS. */
export interface AbandonTask {
  kind: "checkout" | "order";
  id: string;
}

export interface PaymentState {
  /** Props terakhir yang sudah diproses reducer (pola "prev props"). */
  open: boolean;
  total: number;
  totalAfterArk: number;
  submitting: boolean;
  code: string;
  method: PaymentMethod;
  cashInput: string;
  // Metode FOC (Free of Charge) — wajib PIN supervisor (owner 2026-08-24);
  // verifikasi sesungguhnya di server, input di sini hanya mengumpulkan PIN.
  supervisorPin: string;
  nfcInput: string;
  nfcChecking: boolean;
  nfcResult: (NfcTabCheckResult & { uid: string }) | null;
  // EPIC-034 Fase C — kode gift card diketik/di-scan kasir
  giftInput: string;
  giftChecking: boolean;
  giftResult: (GiftCardCheckResult & { code: string }) | null;
  qris: QrisState;
  settleAttempts: number;
  preparedCheckout: PreparedCheckout | null;
  preparedOrder: PreparedOrder | null;
  abandon: AbandonTask[];
}

export interface TrackedProps {
  open: boolean;
  total: number;
  totalAfterArk: number;
  submitting: boolean;
}

export type PaymentAction =
  | ({ type: "props-changed" } & TrackedProps)
  | { type: "method-picked"; code: string; method: PaymentMethod }
  | { type: "cash-input-changed"; value: string }
  | { type: "supervisor-pin-changed"; value: string }
  | { type: "nfc-input-changed"; value: string }
  | { type: "nfc-check-started" }
  | { type: "nfc-check-finished"; result: NfcTabCheckResult & { uid: string } }
  | { type: "gift-input-changed"; value: string }
  | { type: "gift-check-started" }
  | { type: "gift-check-finished"; result: GiftCardCheckResult & { code: string } }
  | { type: "checkout-prepared"; checkout: PreparedCheckout }
  | { type: "order-prepared"; order: PreparedOrder }
  | { type: "qris-ready"; qr: QrisCode }
  | { type: "qris-unavailable"; error: string }
  | { type: "qris-settle-started"; qrId: string }
  | { type: "qris-settled"; qrId: string }
  | { type: "qris-settle-failed"; qrId: string; message: string };

const IDLE: QrisState = { status: "idle" };

const RESET_FIELDS = {
  code: "cash",
  method: "cash" as PaymentMethod,
  cashInput: "",
  supervisorPin: "",
  nfcInput: "",
  nfcChecking: false,
  nfcResult: null,
  giftInput: "",
  giftChecking: false,
  giftResult: null,
  qris: IDLE,
  settleAttempts: 0,
  preparedCheckout: null,
  preparedOrder: null,
} satisfies Omit<PaymentState, keyof TrackedProps | "abandon">;

/** Antrian dibatasi; effect menandai task yang sudah dieksekusi. */
const ABANDON_QUEUE_LIMIT = 10;

export function initialPaymentState(props: TrackedProps): PaymentState {
  return { ...props, ...RESET_FIELDS, abandon: [] };
}

export function qrOf(qris: QrisState): QrisCode | null {
  return "qr" in qris ? qris.qr : null;
}

/** Uang sudah diterima Xendit: jangan batalkan checkout/order yang terikat. */
function isQrisPaid(qris: QrisState): boolean {
  return qris.status === "paid" || qris.status === "settle_error";
}

function enqueueAbandon(state: PaymentState, tasks: AbandonTask[]): AbandonTask[] {
  if (tasks.length === 0) return state.abandon;
  return [...state.abandon, ...tasks].slice(-ABANDON_QUEUE_LIMIT);
}

function preparedTasks(state: PaymentState): AbandonTask[] {
  const tasks: AbandonTask[] = [];
  if (state.preparedCheckout) {
    tasks.push({ kind: "checkout", id: state.preparedCheckout.checkout_id });
  }
  if (state.preparedOrder) {
    tasks.push({ kind: "order", id: state.preparedOrder.order_id });
  }
  return tasks;
}

/**
 * Bug #5 fix (insiden 2026-08-25): order 'unpaid' yang sempat disiapkan utk
 * QRIS jual instan tapi kasir batal (tutup modal / ganti metode) dibatalkan
 * supaya tidak nyangkut selamanya sebagai order kosong di Orders. Item + stok
 * BOM/merchandise sudah diklaim saat prepare, jadi pembatalan lewat status
 * 'cancelled' (bukan hapus baris); route PATCH order mengembalikan stoknya.
 */
function endQrisSession(state: PaymentState, submitting: boolean): PaymentState {
  const keep = isQrisPaid(state.qris) || submitting;
  return {
    ...state,
    qris: IDLE,
    preparedCheckout: null,
    preparedOrder: null,
    abandon: enqueueAbandon(state, keep ? [] : preparedTasks(state)),
  };
}

/** Nominal berubah: QR dan checkout lama basi, order jual-instan dibatalkan. */
function onAmountChanged(
  state: PaymentState,
  amount: number,
  submitting: boolean
): PaymentState {
  const keep = isQrisPaid(state.qris) || submitting;
  const tasks: AbandonTask[] = [];
  const checkout = state.preparedCheckout;
  if (checkout && checkout.amount !== amount && !keep) {
    tasks.push({ kind: "checkout", id: checkout.checkout_id });
  }
  const order = state.preparedOrder;
  if (order && !keep) tasks.push({ kind: "order", id: order.order_id });
  return {
    ...state,
    qris: IDLE,
    preparedCheckout: null,
    preparedOrder: keep ? order : null,
    abandon: enqueueAbandon(state, tasks),
  };
}

function onPropsChanged(state: PaymentState, props: TrackedProps): PaymentState {
  let next: PaymentState = { ...state, ...props };
  if (state.open && !props.open) {
    // Bug #5 review fix (insiden 2026-08-25): modal tidak pernah di-remount
    // antar transaksi, jadi tutup modal wajib membersihkan order yang
    // disiapkan supaya order basi tidak kepakai ulang di cart berikutnya.
    next = { ...endQrisSession(next, props.submitting), ...RESET_FIELDS };
  }
  // Total berubah (item ditambah/dihapus) → hasil cek gift card basi: saldo
  // yang tadinya menutup bisa jadi kurang. Paksa kasir cek ulang.
  if (props.total !== state.total) next.giftResult = null;
  if (props.totalAfterArk !== state.totalAfterArk) {
    next = onAmountChanged(next, props.totalAfterArk, props.submitting);
  }
  // Submit selesai tanpa settle error → kembali polling (kasir-page bisa
  // menolak tanpa throw).
  if (
    state.submitting &&
    !props.submitting &&
    props.open &&
    next.qris.status === "paid"
  ) {
    next.qris = { status: "ready", qr: next.qris.qr };
  }
  return next;
}

function sameQr(qris: QrisState, qrId: string): boolean {
  return qrOf(qris)?.qr_id === qrId;
}

export function paymentReducer(
  state: PaymentState,
  action: PaymentAction
): PaymentState {
  switch (action.type) {
    case "props-changed":
      return onPropsChanged(state, {
        open: action.open,
        total: action.total,
        totalAfterArk: action.totalAfterArk,
        submitting: action.submitting,
      });
    case "method-picked": {
      const left =
        state.method === "qris" && action.method !== "qris"
          ? endQrisSession(state, state.submitting)
          : state;
      return {
        ...left,
        code: action.code,
        method: action.method,
        supervisorPin: "",
      };
    }
    case "cash-input-changed":
      return { ...state, cashInput: String(parseIdrDigits(action.value) || "") };
    case "supervisor-pin-changed":
      return { ...state, supervisorPin: action.value.replace(/\D/g, "") };
    case "nfc-input-changed":
      return { ...state, nfcInput: action.value };
    case "nfc-check-started":
      return { ...state, nfcChecking: true, nfcInput: "" };
    case "nfc-check-finished":
      return { ...state, nfcChecking: false, nfcResult: action.result };
    case "gift-input-changed":
      // Kode diubah → hasil cek sebelumnya tidak berlaku lagi
      return { ...state, giftInput: action.value.toUpperCase(), giftResult: null };
    case "gift-check-started":
      return { ...state, giftChecking: true };
    case "gift-check-finished":
      return { ...state, giftChecking: false, giftResult: action.result };
    case "checkout-prepared":
      return { ...state, preparedCheckout: action.checkout };
    case "order-prepared":
      return { ...state, preparedOrder: action.order };
    case "qris-ready":
      return { ...state, qris: { status: "ready", qr: action.qr }, settleAttempts: 0 };
    case "qris-unavailable":
      return { ...state, qris: { status: "unavailable", error: action.error } };
    case "qris-settle-started": {
      const { qris } = state;
      if (!sameQr(qris, action.qrId)) return state;
      if (qris.status === "ready") {
        return { ...state, qris: { status: "paid", qr: qris.qr } };
      }
      if (qris.status === "settle_error") {
        // Retry manual kasir: hitungan auto-retry mulai dari nol lagi.
        return { ...state, qris: { status: "paid", qr: qris.qr }, settleAttempts: 0 };
      }
      return state;
    }
    case "qris-settled":
      return sameQr(state.qris, action.qrId) ? { ...state, settleAttempts: 0 } : state;
    case "qris-settle-failed": {
      const { qris } = state;
      // "ready" juga diterima: submitting bisa sudah turun lebih dulu.
      if (!sameQr(qris, action.qrId)) return state;
      if (qris.status !== "paid" && qris.status !== "ready") return state;
      const settleAttempts = state.settleAttempts + 1;
      if (shouldStopQrisAutoRetry(settleAttempts)) {
        return {
          ...state,
          settleAttempts,
          qris: { status: "settle_error", qr: qris.qr, message: action.message },
        };
      }
      return { ...state, settleAttempts, qris: { status: "ready", qr: qris.qr } };
    }
  }
}

// ── Derivasi (dihitung tiap render, bukan disinkron lewat effect) ──

export interface PaymentOption {
  code: string;
  cashierKey: PaymentMethod;
  title: string;
  desc: string;
  icon: string;
}

export function buildPaymentOptions(
  methods: PosPaymentMethod[] | undefined,
  available: { nfcTab: boolean; giftCard: boolean }
): PaymentOption[] {
  const source =
    methods && methods.length > 0
      ? methods
      : DEFAULT_POS_PAYMENT_METHODS.filter((m) => m.is_active);
  return source
    .filter((option) => {
      if (option.code === "nfc_tab") return available.nfcTab;
      if (option.code === "gift_card") return available.giftCard;
      return true;
    })
    .map((option) => ({
      code: option.code,
      cashierKey: cashierMethodFromHandler(option.handler),
      title: option.name,
      desc: option.description,
      icon: option.icon,
    }));
}

export interface TenderContext {
  isMixedCart: boolean;
  isCheckoutBill: boolean;
}

function isBlockedTender(method: PaymentMethod, ctx: TenderContext): boolean {
  return (
    (ctx.isMixedCart && isMixedUnsupportedTender(method)) ||
    (ctx.isCheckoutBill && isCheckoutBillUnsupportedTender(method))
  );
}

/**
 * Metode efektif: tender yang tidak didukung (cart multi-stall / bayar
 * checkout) jatuh ke tunai; kode yang hilang dari katalog jatuh ke opsi pertama.
 */
export function resolveSelection(
  selection: { code: string; method: PaymentMethod },
  options: PaymentOption[],
  ctx: TenderContext
): { code: string; method: PaymentMethod } {
  const allowed = isBlockedTender(selection.method, ctx)
    ? { code: "cash", method: "cash" }
    : { code: selection.code, method: selection.method };
  const first = options[0];
  if (first && !options.some((option) => option.code === allowed.code)) {
    return { code: first.code, method: first.cashierKey };
  }
  return allowed;
}

export function arkToUseFor(
  method: PaymentMethod,
  customer: Pick<PaymentCustomer, "ark_coin_balance"> | null,
  total: number
): number {
  if (method !== "ark_coin" || !customer) return 0;
  return Math.min(customer.ark_coin_balance, total);
}

export function cashSummary(
  method: PaymentMethod,
  cashInput: string,
  totalAfterArk: number
): { cashAmount: number; change: number } {
  const cashAmount = parseIdrDigits(cashInput);
  return { cashAmount, change: method === "cash" ? cashAmount - totalAfterArk : 0 };
}

export function isPaymentValid(input: {
  method: PaymentMethod;
  focSelected: boolean;
  customer: Pick<PaymentCustomer, "ark_coin_balance"> | null;
  supervisorPin: string;
  cashAmount: number;
  total: number;
  totalAfterArk: number;
  nfcResult: NfcTabCheckResult | null;
  giftResult: GiftCardCheckResult | null;
}): boolean {
  if (input.focSelected) {
    // FOC wajib ber-customer/member (owner 2026-08-24) + PIN supervisor.
    return Boolean(input.customer) && /^\d{4,6}$/.test(input.supervisorPin.trim());
  }
  switch (input.method) {
    case "cash":
      return input.cashAmount >= input.totalAfterArk;
    case "ark_coin":
      return !!input.customer && input.customer.ark_coin_balance >= input.total;
    case "nfc_tab":
      return input.nfcResult?.ok === true;
    case "gift_card":
      // Full-cover only (keputusan owner): saldo kurang → kasir minta metode
      // lain, tidak ada bayar sebagian.
      return input.giftResult?.ok === true && input.giftResult.covers === true;
    default:
      return true;
  }
}

/** QR dinamis perlu dibuat (QRIS aktif dan belum ada QR yang cocok). */
export function qrisNeedsPrepare(
  state: Pick<PaymentState, "qris" | "preparedCheckout">,
  input: { active: boolean; totalAfterArk: number; isMixedCart: boolean }
): boolean {
  const { qris, preparedCheckout } = state;
  if (!input.active) return false;
  if (qris.status !== "idle" && qris.status !== "ready") return false;
  return !shouldSkipQrisPrepare({
    qrisLoading: false,
    existingQrAmount: qrOf(qris)?.amount ?? null,
    currentAmount: input.totalAfterArk,
    mixedCheckoutId: mixedQrisCheckoutIdForAmount({
      checkoutId: preparedCheckout?.checkout_id,
      boundAmount: preparedCheckout?.amount,
      currentAmount: input.totalAfterArk,
    }),
    isMixedCart: input.isMixedCart,
  });
}

/**
 * Bug #5 fix (insiden 2026-08-25): satu tempat membangun payload confirm
 * QRIS. orderId ikut kalau ada order yang disiapkan (jual instan) ATAU sedang
 * bayar open bill, supaya kasir-page menyelesaikannya lewat jalur "bayar open
 * bill" yang sama persis.
 */
export function buildQrisConfirmPayload(input: {
  qr: QrisCode;
  preparedCheckout: PreparedCheckout | null;
  preparedOrder: PreparedOrder | null;
  payingOrderId: string | null;
}): PaymentConfirmPayload {
  const { qr, preparedCheckout, preparedOrder } = input;
  return {
    method: "qris",
    cashReceived: "",
    arkToUse: 0,
    checkoutId: preparedCheckout?.checkout_id,
    checkoutNumber: preparedCheckout?.checkout_number,
    queueNumber: preparedCheckout?.queue_number,
    orderId: input.payingOrderId || preparedOrder?.order_id || undefined,
    orderNumber: preparedOrder?.order_number,
    xenditQrId: qr.qr_id,
    xenditExternalId: qr.reference_id,
    paymentMethodCode: "qris",
    paymentMethodName: "QRIS",
  };
}

/** Payload tombol "Confirm payment" (semua metode selain QRIS). */
export function buildConfirmPayload(input: {
  method: PaymentMethod;
  code: string;
  optionTitle?: string;
  focSelected: boolean;
  cashAmount: number;
  arkToUse: number;
  supervisorPin: string;
  nfcResult: PaymentState["nfcResult"];
  giftResult: PaymentState["giftResult"];
}): PaymentConfirmPayload {
  const { method, nfcResult, giftResult } = input;
  return {
    method,
    cashReceived: String(input.cashAmount || ""),
    arkToUse: input.arkToUse,
    nfcTabUid: method === "nfc_tab" && nfcResult?.ok ? nfcResult.uid : undefined,
    giftCardCode: method === "gift_card" && giftResult?.ok ? giftResult.code : undefined,
    paymentMethodCode: input.code,
    paymentMethodName: input.optionTitle,
    supervisorPin: input.focSelected ? input.supervisorPin.trim() : undefined,
  };
}
