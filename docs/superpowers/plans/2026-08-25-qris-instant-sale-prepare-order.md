# QRIS Instant-Sale Prepare-Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop QRIS payments for instant (non-open-bill, non-mixed-cart) POS sales from becoming permanently untraceable when order-creation fails after the customer has already paid — confirmed today: 4 payments totaling Rp77.500, real money captured by Xendit with zero matching record anywhere in the database (root cause: "Bug #5" investigation, 2026-08-25).

**Architecture:** Mirror the mixed-cart QRIS pattern that already works safely in production: create the `pos_orders` row FIRST (via the existing `/api/pos/orders/open-bill` endpoint, `payment_status: 'unpaid'`, items + BOM/merchandise stock claimed immediately — this endpoint already exists and is battle-tested for table orders), bind the QR to that `order_id`, then settle it through the exact same "pay an open bill" path (`PATCH /api/pos/orders/[id]`) already hardened by Bug #1–#4 (QR reuse, webhook auto-settle, retry cap, reservation fallback). If order-creation-before-payment fails, nothing has been charged yet — safe. If settlement-after-payment fails, the order row still exists with items and a valid `xendit_qr_id` — staff can find and resolve it from the Orders page instead of it vanishing.

**Tech Stack:** Next.js App Router API routes, React (client component), PostgreSQL via `DbClient` wrapper, Vitest for pure-function unit tests.

## Global Constraints

- Base this work on branch `hotfix/pos-qris-payment-stuck` (already contains Bug #1–#4 fixes this depends on: QR reuse in `qris/route.ts`, `settleOrderQrisPayment` webhook handler, `shouldStopQrisAutoRetry` in `central-cashier.ts`). Create a new branch `fix/pos-qris-instant-sale-orphan` from it.
- Do not touch the mixed-cart (`isMixedCart`) code path — it already works; this plan only changes the single-stall, non-open-bill QRIS path (`!isMixedCart && !payingOrderId`).
- Every new pure/branching decision goes into `src/lib/pos/central-cashier.ts` with a Vitest unit test in `src/lib/pos/central-cashier.test.ts` — this repo's established convention (see `shouldSkipQrisPrepare`, `mayConfirmMixedQris`, `shouldStopQrisAutoRetry`).
- Indonesian code comments matching the existing style (see `// Bug #N fix (insiden 2026-08-25): ...` comments already in the touched files) — tag new comments `// Bug #5 fix (insiden 2026-08-25): ...`.
- Run `npx tsc --noEmit -p tsconfig.json`, `npx eslint <changed files>`, and `npx vitest run src/lib/pos/ src/components/pos/` after every task; only pre-existing baseline errors (documented in the hotfix branch: 4 tsc errors in `create-mixed-checkout.ts`/`.test.ts`, 12 eslint errors — 11 in `PaymentModal.tsx`, 1 in `central-cashier.ts`) are acceptable. Zero new errors.

---

### Task 1: `shouldPrepareOrderForQris` pure helper

**Files:**
- Modify: `src/lib/pos/central-cashier.ts` (add near `shouldSkipQrisPrepare`, after `QRIS_MAX_AUTO_CONFIRM_ATTEMPTS`/`shouldStopQrisAutoRetry` block)
- Test: `src/lib/pos/central-cashier.test.ts`

**Interfaces:**
- Produces: `shouldPrepareOrderForQris(input: { method: string; isMixedCart: boolean; payingOrderId?: string | null; hasPreparedOrder: boolean }): boolean` — used by Task 3 (PaymentModal effect) to decide whether to call `onPrepareOrderQris` before generating a QR.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/pos/central-cashier.test.ts`, inside the existing `describe("mixed cart payment UI", ...)` block (near the `shouldStopQrisAutoRetry` tests added for Bug #3), and add `shouldPrepareOrderForQris` to the import list at the top of the file (alongside `shouldStopQrisAutoRetry`):

```ts
  // Bug #5 (insiden 2026-08-25): QRIS "jual instan" (bukan open bill, bukan
  // checkout multi-stall) tidak punya order tersimpan sebelum QR muncul —
  // kalau order gagal dibuat setelah customer bayar, uangnya orphan tanpa
  // jejak. Fix: bikin order 'unpaid' dulu (mirror pola checkout), baru QR.
  describe("shouldPrepareOrderForQris", () => {
    it("prepares an order for a plain single-stall QRIS sale", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(true);
    });

    it("skips prepare once an order is already prepared", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: true,
        })
      ).toBe(false);
    });

    it("skips prepare when paying an existing open bill", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: "ord-1",
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });

    it("skips prepare for mixed-cart (checkout handles its own prepare)", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: true,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });

    it("skips prepare for non-QRIS methods", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "cash",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pos/central-cashier.test.ts`
Expected: FAIL — `shouldPrepareOrderForQris is not defined` / import error.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/pos/central-cashier.ts`, add directly after the `shouldStopQrisAutoRetry` function:

```ts
// Bug #5 fix (insiden 2026-08-25): QRIS "jual instan" (bukan open bill,
// bukan checkout multi-stall) sebelumnya membuat order BARU muncul di DB
// setelah pembayaran dikonfirmasi — kalau proses itu gagal (validasi,
// sesi habis, tab ditutup), uang yang sudah diterima Xendit jadi orphan
// tanpa jejak apapun (4 kasus, Rp77.500, hari ini). Fix: order dibuat
// 'unpaid' DULU (mirror pola checkout multi-stall), baru QR diikat ke
// order itu — kalau gagal SETELAH bayar, order tetap ada & bisa
// diselesaikan manual dari Orders, bukan hilang.
export function shouldPrepareOrderForQris(input: {
  method: string;
  isMixedCart: boolean;
  payingOrderId?: string | null;
  hasPreparedOrder: boolean;
}): boolean {
  if (input.method !== "qris") return false;
  if (input.isMixedCart) return false;
  if (input.payingOrderId) return false;
  if (input.hasPreparedOrder) return false;
  return true;
}
```

Also add `shouldPrepareOrderForQris` to the `import { ... } from "./central-cashier"` list in `central-cashier.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pos/central-cashier.test.ts`
Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pos/central-cashier.ts src/lib/pos/central-cashier.test.ts
git commit -m "feat(pos): add shouldPrepareOrderForQris helper (Bug #5)"
```

---

### Task 2: `openBill` client helper for a bare single-stall unpaid order

**Files:**
- Modify: `src/lib/pos-api.ts:365-369` (existing `openBill` function — no signature change needed, just confirm it is exported; this task adds nothing new here, it is a checkpoint, see Step 1)
- Modify: `src/features/pos/cashier/api.ts:1-10,129` (re-export already present — verify)

**Interfaces:**
- Consumes: existing `openBill(payload: OpenBillRequest)` from `src/lib/pos-api.ts:365`, which POSTs to `/api/pos/orders/open-bill` and returns `{ success: boolean; data: Order; error?: string }`. `Order` (from `src/lib/pos-api.ts:405`) has `id`, `order_number`, `queue_number`.
- Produces: nothing new — this task only verifies the existing wrapper is reachable from `cashier-page.tsx` (it already is, imported at `src/features/pos/cashier/components/cashier-page.tsx` via `usePosCheckout`'s sibling imports — confirm `openBill` is imported directly there too, add the import if missing).

- [ ] **Step 1: Verify the existing wrapper compiles standalone**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "pos-api.ts"`
Expected: no new errors (this file is unmodified by this task).

- [ ] **Step 2: Confirm import path for Task 5**

Run: `grep -n "^import" src/features/pos/cashier/components/cashier-page.tsx | grep -i "pos-api\|cashier/api"`
Expected output includes a line importing from `@/lib/pos-api` or `../api` (the local `cashier/api.ts` re-export barrel). Note which one — Task 5 will import `openBill` from whichever module already supplies `openBill` in that file (if neither imports it yet, Task 5 adds `import { openBill } from '@/lib/pos-api';` alongside the existing `usePosCheckout` import).

- [ ] **Step 3: Commit**

No file changes in this task — skip commit (this task is a verification checkpoint feeding Task 5's import decision). Record the answer from Step 2 as a one-line note in the PR description when this plan is executed.

---

### Task 3: PaymentModal — prepare a bare order before generating QR

**Files:**
- Modify: `src/components/pos/PaymentModal.tsx:99-162` (Props interface)
- Modify: `src/components/pos/PaymentModal.tsx:164-227` (component state/refs)
- Modify: `src/components/pos/PaymentModal.tsx:406-498` (QR-prepare effect)
- Test: manual (this is a React effect with network calls; covered by the pure helper's unit test in Task 1 plus the manual QA checklist in Task 7)

**Interfaces:**
- Consumes: `shouldPrepareOrderForQris` from Task 1 (`@/lib/pos/central-cashier`); `onPrepareOrderQris` new prop (implemented in Task 5) with signature `() => Promise<{ order_id: string; order_number?: string; queue_number?: string | null }>`.
- Produces: new component state `preparedOrderQris: { order_id: string; order_number?: string; queue_number?: string | null } | null`, read by Task 4 (payload builder + confirm) and used to resolve the effective `orderId` for `buildPosQrisCreateBody`.

- [ ] **Step 1: Add the new prop to the Props interface**

In `src/components/pos/PaymentModal.tsx`, find (around line 157-161):

```ts
  payingOrderId?: string | null;
  onPrepareMixedQrisCheckout?: () => Promise<{
    checkout_id: string;
    checkout_number?: string;
    queue_number?: string | null;
  }>;
```

Replace with:

```ts
  payingOrderId?: string | null;
  onPrepareMixedQrisCheckout?: () => Promise<{
    checkout_id: string;
    checkout_number?: string;
    queue_number?: string | null;
  }>;
  /**
   * Bug #5 fix (insiden 2026-08-25): jual instan via QRIS (bukan open bill,
   * bukan checkout multi-stall) — dipanggil SEBELUM QR dibuat supaya order
   * tersimpan 'unpaid' duluan (mirror onPrepareMixedQrisCheckout), sehingga
   * kalau settle gagal setelah customer bayar, order tetap ada & bisa
   * diselesaikan manual — bukan hilang tanpa jejak.
   */
  onPrepareOrderQris?: () => Promise<{
    order_id: string;
    order_number?: string;
    queue_number?: string | null;
  }>;
```

- [ ] **Step 2: Destructure the new prop**

Find (around line 181-182):

```ts
  payingOrderId = null,
  onPrepareMixedQrisCheckout,
```

Replace with:

```ts
  payingOrderId = null,
  onPrepareMixedQrisCheckout,
  onPrepareOrderQris,
```

- [ ] **Step 3: Add state for the prepared order**

Find (around line 206-211):

```ts
  const [qrisPaid, setQrisPaid] = useState(false);
  // Bug #3 fix (insiden 2026-08-25): pesan error saat settle QRIS gagal
  // berulang — Xendit sudah bilang lunas tapi server terus menolak
  // (mis. 409 nominal berubah). Berhenti auto-retry, tampilkan ke kasir.
  const [qrisSettleError, setQrisSettleError] = useState<string | null>(null);
  const qrisConfirmAttempts = useRef(0);
```

Replace with:

```ts
  const [qrisPaid, setQrisPaid] = useState(false);
  // Bug #3 fix (insiden 2026-08-25): pesan error saat settle QRIS gagal
  // berulang — Xendit sudah bilang lunas tapi server terus menolak
  // (mis. 409 nominal berubah). Berhenti auto-retry, tampilkan ke kasir.
  const [qrisSettleError, setQrisSettleError] = useState<string | null>(null);
  const qrisConfirmAttempts = useRef(0);
  // Bug #5 fix (insiden 2026-08-25): order 'unpaid' yang dibuat via
  // onPrepareOrderQris sebelum QR jual-instan dimunculkan.
  const [preparedOrderQris, setPreparedOrderQris] = useState<{
    order_id: string;
    order_number?: string;
    queue_number?: string | null;
  } | null>(null);
  const preparedOrderQrisRef = useRef(preparedOrderQris);
  preparedOrderQrisRef.current = preparedOrderQris;
```

- [ ] **Step 4: Reset prepared-order state whenever the modal closes or the cart total changes**

Find the effect that resets QRIS state on total/customer change (around line 396-403, just above the QR-prepare effect):

```ts
    setGiftResult(null);
  }, [total]);
  // Buat QR dinamis saat QRIS dipilih. Gagal → jangan settle; kasir pilih
  // metode lain. Confirm QRIS hanya lewat poll Xendit (bukan klik manual).
  useEffect(() => {
    if (!open || method !== "qris") return;
```

Replace with:

```ts
    setGiftResult(null);
  }, [total]);
  // Bug #5 fix (insiden 2026-08-25): total berubah (item ditambah/dihapus)
  // sebelum bayar → order 'unpaid' yang sempat disiapkan tidak lagi cocok
  // dengan cart; lupakan supaya effect di bawah menyiapkan yang baru.
  useEffect(() => {
    setPreparedOrderQris(null);
  }, [totalAfterArk]);
  // Buat QR dinamis saat QRIS dipilih. Gagal → jangan settle; kasir pilih
  // metode lain. Confirm QRIS hanya lewat poll Xendit (bukan klik manual).
  useEffect(() => {
    if (!open || method !== "qris") return;
```

- [ ] **Step 5: Call the prepare step inside the QR-prepare effect's `run()` function**

Find (around line 430-446, the start of `run()` inside the QR-prepare effect):

```ts
    const run = async () => {
      let checkoutId = mixedQrisCheckoutIdForAmount({
        checkoutId: mixedQrisCheckout?.checkout_id,
        boundAmount: mixedQrisCheckout?.amount,
        currentAmount: totalAfterArk,
      });
      if (isMixedCart) {
        if (!onPrepareMixedQrisCheckout) {
          throw new Error("Checkout multi-stall membutuhkan persiapan QRIS");
        }
        if (!checkoutId) {
          const prepared = await onPrepareMixedQrisCheckout();
          if (cancelled) return;
          checkoutId = prepared.checkout_id;
          setMixedQrisCheckout({ ...prepared, amount: totalAfterArk });
        }
      }

      const res = await fetch("/api/pos/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPosQrisCreateBody({
            amount: totalAfterArk,
            checkoutId,
            orderId: payingOrderId,
          })
        ),
      });
```

Replace with:

```ts
    const run = async () => {
      let checkoutId = mixedQrisCheckoutIdForAmount({
        checkoutId: mixedQrisCheckout?.checkout_id,
        boundAmount: mixedQrisCheckout?.amount,
        currentAmount: totalAfterArk,
      });
      if (isMixedCart) {
        if (!onPrepareMixedQrisCheckout) {
          throw new Error("Checkout multi-stall membutuhkan persiapan QRIS");
        }
        if (!checkoutId) {
          const prepared = await onPrepareMixedQrisCheckout();
          if (cancelled) return;
          checkoutId = prepared.checkout_id;
          setMixedQrisCheckout({ ...prepared, amount: totalAfterArk });
        }
      }

      // Bug #5 fix (insiden 2026-08-25): jual instan single-stall — bikin
      // order 'unpaid' DULU supaya QR selalu terikat ke order tersimpan,
      // sama seperti checkout multi-stall di atas. Kalau bayar gagal
      // ter-settle, order tetap ada di Orders (bukan orphan tanpa jejak).
      let orderId = payingOrderId || preparedOrderQrisRef.current?.order_id || null;
      if (
        shouldPrepareOrderForQris({
          method,
          isMixedCart,
          payingOrderId,
          hasPreparedOrder: Boolean(preparedOrderQrisRef.current),
        })
      ) {
        if (!onPrepareOrderQris) {
          throw new Error("Penjualan QRIS membutuhkan persiapan order");
        }
        const prepared = await onPrepareOrderQris();
        if (cancelled) return;
        setPreparedOrderQris(prepared);
        orderId = prepared.order_id;
      }

      const res = await fetch("/api/pos/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPosQrisCreateBody({
            amount: totalAfterArk,
            checkoutId,
            orderId,
          })
        ),
      });
```

- [ ] **Step 6: Add the new import**

Find the `central-cashier` import block (around line 34-43):

```ts
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  buildPosQrisCreateBody,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  mayConfirmMixedQris,
  mixedQrisCheckoutIdForAmount,
  shouldSkipQrisPrepare,
  shouldStopQrisAutoRetry,
} from "@/lib/pos/central-cashier";
```

Replace with:

```ts
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  buildPosQrisCreateBody,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  mayConfirmMixedQris,
  mixedQrisCheckoutIdForAmount,
  shouldPrepareOrderForQris,
  shouldSkipQrisPrepare,
  shouldStopQrisAutoRetry,
} from "@/lib/pos/central-cashier";
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep PaymentModal`
Expected: no output yet — `onPrepareOrderQris` is unused-but-optional so this compiles; `method` variable must already be in scope (it is — component prop). If tsc reports `preparedOrderQris` declared but never read, ignore for now — Task 4 reads it.

- [ ] **Step 8: Commit**

```bash
git add src/components/pos/PaymentModal.tsx
git commit -m "feat(pos): prepare unpaid order before instant-sale QRIS QR (Bug #5)"
```

---

### Task 4: PaymentModal — thread the prepared order id through confirm/retry, and abandon it on close

**Files:**
- Modify: `src/components/pos/PaymentModal.tsx:99-126` (`onConfirm` payload type)
- Modify: `src/components/pos/PaymentModal.tsx:507-545` (`runQrisConfirm` / `retryQrisSettle`)
- Modify: `src/components/pos/PaymentModal.tsx:578-589` (poll `tick()` confirm call)
- Modify: `src/components/pos/PaymentModal.tsx:1007-1027` (manual "Confirm payment" button, non-QRIS branch — no `orderId` needed there, verify it does NOT need touching)
- Modify: `src/components/pos/PaymentModal.tsx:223-233` (`abandonPreparedMixedQris` / `handleClose`)

**Interfaces:**
- Consumes: `preparedOrderQris` state from Task 3.
- Produces: `onConfirm` payload gains `orderId?: string`, consumed by `cashier-page.tsx`'s `handleCreateOrder` in Task 6.

- [ ] **Step 1: Add `orderId` to the `onConfirm` payload type**

Find (around line 109-126):

```ts
  onConfirm: (payload: {
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
    xenditQrId?: string;
    xenditExternalId?: string;
    paymentMethodCode?: string;
    paymentMethodName?: string;
    /** PIN supervisor — terisi saat metode FOC (diverifikasi ulang server). */
    supervisorPin?: string;
  }) => void | Promise<void>;
```

Replace with:

```ts
  onConfirm: (payload: {
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
  }) => void | Promise<void>;
```

- [ ] **Step 2: Add a shared payload builder and use it in both `retryQrisSettle` and `tick()`**

Find (around line 507-545):

```ts
  const runQrisConfirm = (payload: Parameters<typeof onConfirm>[0]) => {
    qrisConfirmStarted.current = true;
    setQrisPaid(true);
    void Promise.resolve(onConfirmRef.current(payload))
      .then(() => {
        qrisConfirmAttempts.current = 0;
      })
      .catch((err: unknown) => {
        qrisConfirmAttempts.current += 1;
        if (shouldStopQrisAutoRetry(qrisConfirmAttempts.current)) {
          const message =
            err instanceof Error ? err.message : "Gagal menyelesaikan pembayaran QRIS";
          setQrisSettleError(message);
          // qrisConfirmStarted TETAP true — cegah poll auto-retry lagi;
          // kasir lanjut lewat tombol "Coba lagi" (retryQrisSettle).
        } else {
          qrisConfirmStarted.current = false;
          setQrisPaid(false);
        }
      });
  };

  const retryQrisSettle = () => {
    if (!qris?.qr_id) return;
    setQrisSettleError(null);
    qrisConfirmAttempts.current = 0;
    runQrisConfirm({
      method: "qris",
      cashReceived: "",
      arkToUse,
      checkoutId: mixedQrisCheckout?.checkout_id,
      checkoutNumber: mixedQrisCheckout?.checkout_number,
      queueNumber: mixedQrisCheckout?.queue_number,
      xenditQrId: qris.qr_id,
      xenditExternalId: qris.reference_id,
      paymentMethodCode: "qris",
      paymentMethodName: "QRIS",
    });
  };
```

Replace with:

```ts
  // Bug #5 fix (insiden 2026-08-25): satu tempat membangun payload confirm
  // QRIS — orderId ikut disertakan kalau ada order yang disiapkan lebih
  // dulu (jual instan) ATAU sedang bayar open bill, supaya kasir-page bisa
  // menyelesaikannya lewat jalur "bayar open bill" yang sama persis.
  const buildQrisConfirmPayload = (): Parameters<typeof onConfirm>[0] => ({
    method: "qris",
    cashReceived: "",
    arkToUse,
    checkoutId: mixedQrisCheckout?.checkout_id,
    checkoutNumber: mixedQrisCheckout?.checkout_number,
    queueNumber: mixedQrisCheckout?.queue_number,
    orderId: payingOrderId || preparedOrderQris?.order_id || undefined,
    orderNumber: preparedOrderQris?.order_number,
    xenditQrId: qris?.qr_id,
    xenditExternalId: qris?.reference_id,
    paymentMethodCode: "qris",
    paymentMethodName: "QRIS",
  });

  const runQrisConfirm = (payload: Parameters<typeof onConfirm>[0]) => {
    qrisConfirmStarted.current = true;
    setQrisPaid(true);
    void Promise.resolve(onConfirmRef.current(payload))
      .then(() => {
        qrisConfirmAttempts.current = 0;
      })
      .catch((err: unknown) => {
        qrisConfirmAttempts.current += 1;
        if (shouldStopQrisAutoRetry(qrisConfirmAttempts.current)) {
          const message =
            err instanceof Error ? err.message : "Gagal menyelesaikan pembayaran QRIS";
          setQrisSettleError(message);
          // qrisConfirmStarted TETAP true — cegah poll auto-retry lagi;
          // kasir lanjut lewat tombol "Coba lagi" (retryQrisSettle).
        } else {
          qrisConfirmStarted.current = false;
          setQrisPaid(false);
        }
      });
  };

  const retryQrisSettle = () => {
    if (!qris?.qr_id) return;
    setQrisSettleError(null);
    qrisConfirmAttempts.current = 0;
    runQrisConfirm(buildQrisConfirmPayload());
  };
```

- [ ] **Step 3: Use the same builder in `tick()`**

Find (around line 578-589, inside the polling effect's `tick()`):

```ts
          runQrisConfirm({
            method: "qris",
            cashReceived: "",
            arkToUse,
            checkoutId: mixedQrisCheckout?.checkout_id,
            checkoutNumber: mixedQrisCheckout?.checkout_number,
            queueNumber: mixedQrisCheckout?.queue_number,
            xenditQrId: qris.qr_id,
            xenditExternalId: qris.reference_id,
            paymentMethodCode: "qris",
            paymentMethodName: "QRIS",
          });
```

Replace with:

```ts
          runQrisConfirm(buildQrisConfirmPayload());
```

- [ ] **Step 4: Add `preparedOrderQris` to the poll effect's dependency array**

Find the poll effect's dependency array (around line 606-616):

```ts
  }, [
    open,
    method,
    qris?.qr_id,
    qrisUnavailable,
    submitting,
    qrisSettleError,
    arkToUse,
    mixedQrisCheckout,
    isMixedCart,
  ]);
```

Replace with:

```ts
  }, [
    open,
    method,
    qris?.qr_id,
    qrisUnavailable,
    submitting,
    qrisSettleError,
    arkToUse,
    mixedQrisCheckout,
    isMixedCart,
    payingOrderId,
    preparedOrderQris,
  ]);
```

(`buildQrisConfirmPayload` is redefined every render and closes over current state, so this dependency addition keeps `tick`'s captured closure fresh whenever the prepared order changes — same reasoning already documented for the other entries in this array.)

- [ ] **Step 5: Abandon the prepared order if the cashier closes the modal or switches away from QRIS without paying**

Find `abandonPreparedMixedQris` and `handleClose` (around line 223-233):

```ts
  const abandonPreparedMixedQris = (checkoutId?: string | null) => {
    const id = checkoutId || mixedQrisCheckoutRef.current?.checkout_id;
    if (!id || qrisPaidRef.current || submittingRef.current) return;
    void cancelCheckout(id).catch(() => {});
  };

  const handleClose = () => {
    if (submitting) return;
    abandonPreparedMixedQris();
    onClose();
  };
```

Replace with:

```ts
  const abandonPreparedMixedQris = (checkoutId?: string | null) => {
    const id = checkoutId || mixedQrisCheckoutRef.current?.checkout_id;
    if (!id || qrisPaidRef.current || submittingRef.current) return;
    void cancelCheckout(id).catch(() => {});
  };

  // Bug #5 fix (insiden 2026-08-25): order 'unpaid' yang sempat disiapkan
  // utk QRIS jual instan tapi kasir batal (tutup modal / ganti metode) —
  // batalkan supaya tidak nyangkut selamanya sebagai order kosong di
  // Orders. Item + stok BOM/merchandise sudah diklaim saat prepare, jadi
  // pembatalan lewat status 'cancelled' (bukan hapus baris) — route PATCH
  // order yang sudah ada mengembalikan stoknya otomatis.
  const abandonPreparedOrderQris = () => {
    const id = preparedOrderQrisRef.current?.order_id;
    if (!id || qrisPaidRef.current || submittingRef.current) return;
    void onAbandonOrderQris?.(id).catch(() => {});
    setPreparedOrderQris(null);
  };

  const handleClose = () => {
    if (submitting) return;
    abandonPreparedMixedQris();
    abandonPreparedOrderQris();
    onClose();
  };
```

- [ ] **Step 6: Add the `onAbandonOrderQris` prop, and call it from the SAME two existing consolidated effects Task 3 already patched — do not add a new standalone effect**

> **Why this step was rewritten (2026-08-25):** the original version of this step added a brand-new standalone `useEffect(..., [method])` calling `abandonPreparedOrderQris()`. A Task 3 review round caught the identical anti-pattern for `preparedOrderQris`'s state reset (a new one-off effect duplicating logic that belongs in this file's existing consolidated reset effects) and the fix was to integrate into the three pre-existing effects instead — see Task 3 Step 4's amended history. This file already has an established, working precedent for exactly this "abandon on close / abandon on method-switch" need: `abandonPreparedMixedQris()` (the mixed-cart equivalent) is called directly inside the SAME `[open]` effect and the SAME `[isMixedCart, isCheckoutBill, method]` effect that Task 3 Step 4 already added `setPreparedOrderQris(null);` to. Follow that established pattern — do not reintroduce a standalone effect.

In the Props interface, right after the `onPrepareOrderQris` block added in Task 3 Step 1, add:

```ts
  /**
   * Bug #5 fix (insiden 2026-08-25): batalkan order 'unpaid' yang
   * disiapkan onPrepareOrderQris kalau kasir keluar dari QRIS tanpa bayar.
   */
  onAbandonOrderQris?: (orderId: string) => Promise<void>;
```

And destructure it alongside `onPrepareOrderQris` in Task 3 Step 2's replacement (add `onAbandonOrderQris,` on its own line right after `onPrepareOrderQris,`).

Then, in the SAME two effects Task 3 Step 4 already modified, add one `abandonPreparedOrderQris();` call each, placed immediately next to the existing `abandonPreparedMixedQris();` call already in each of those effect bodies (same line grouping, same style — no new effect, no new dependency array):

1. The `[open]` effect — inside `if (!open) { abandonPreparedMixedQris(); ... }`, add `abandonPreparedOrderQris();` right after `abandonPreparedMixedQris();`.
2. The `[isMixedCart, isCheckoutBill, method]` effect — inside `if (method !== "qris") { abandonPreparedMixedQris(); ... }`, add `abandonPreparedOrderQris();` right after `abandonPreparedMixedQris();`.

Read the current file to get the exact surrounding lines before editing (Task 3's fix commit changed these two effects' exact content — search for `abandonPreparedMixedQris();` to find both call sites; there are exactly two, one per effect). `abandonPreparedOrderQris` must be defined (Step 5, above) before either effect runs — since effects are plain functions evaluated at render time referencing another same-render function by closure, definition order in the component body only matters if it's above both effects textually; keep Step 5's `abandonPreparedOrderQris` definition where Step 5 places it (before these two effects appear later in the file) and verify with a read that this ordering holds after Task 3's fix commit.

Note: `abandonPreparedOrderQris()` itself already calls `setPreparedOrderQris(null)` (Step 5's code) — this is a harmless redundant reset alongside the `setPreparedOrderQris(null)` Task 3 Step 4 already placed in these same two effects; the only NEW effect of adding it here is triggering the network abandon call (`onAbandonOrderQris`) that Task 3 intentionally did not add.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep PaymentModal`
Expected: no new errors (only the pre-existing 0 for this file — it had 0 tsc errors before this plan).

Run: `npx eslint src/components/pos/PaymentModal.tsx 2>&1 | tail -20`
Expected: same 11 pre-existing errors as documented in Global Constraints, 0 new ones. If the new `useEffect` in Step 6 trips `react-hooks/set-state-in-effect` beyond the pre-existing 7, that's expected and consistent with the file's existing pattern (it already has 7 instances of this same lint rule pre-suppressed by convention — do not attempt to fix unrelated pre-existing violations in this task).

- [ ] **Step 8: Commit**

```bash
git add src/components/pos/PaymentModal.tsx
git commit -m "feat(pos): thread prepared-order id through QRIS confirm + abandon (Bug #5)"
```

---

### Task 5: cashier-page — implement `onPrepareOrderQris` and `onAbandonOrderQris`

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx` (imports near top; JSX props on `<PaymentModal>` near line 3094-3132, right after the existing `onPrepareMixedQrisCheckout` prop block)

**Interfaces:**
- Consumes: `openBill` from `@/lib/pos-api` (or re-export confirmed in Task 2); `updateOrderStatus` from the same module (already used elsewhere in this file per Task 6's grep); existing `cart`, `selectedTable`/`effectiveTableId`, `selectedCustomer`, `shift`, `billCharges`, `discountAmount`, `taxAmount`, `serviceChargeAmount`, `otherChargesAmount`, `cart.manual_discount_type`, `cart.manual_discount_value`, `offerDiscount`, `offerEval` — all already in scope in this component (used by the existing `onPrepareMixedQrisCheckout` block).
- Produces: `onPrepareOrderQris: () => Promise<{ order_id: string; order_number?: string; queue_number?: string | null }>` and `onAbandonOrderQris: (orderId: string) => Promise<void>`, passed as new props to `<PaymentModal>`, consumed by Task 3/4.

- [ ] **Step 1: Confirm `openBill` and `updateOrderStatus` imports**

Run: `grep -n "openBill\|updateOrderStatus" src/features/pos/cashier/components/cashier-page.tsx | head -5`

If neither is imported yet, add to the existing `@/lib/pos-api` (or `../api`) import statement at the top of the file — whichever module Task 2 Step 2 identified as already supplying `Order`/other pos-api types in this file. Do not create a second import statement for the same module; extend the existing named-import list.

- [ ] **Step 2: Add the two new handlers as props on `<PaymentModal>`**

Find the `onPrepareMixedQrisCheckout` prop block on `<PaymentModal>` (around line 3097-3130):

```tsx
        onPrepareMixedQrisCheckout={
          isMixedCart
            ? async () => {
                const res = await checkout({
                  cart: cart.items,
                  orderType: cart.orderType,
                  selectedTable: effectiveTableId,
                  selectedCustomer,
                  paymentMethod: 'qris',
                  cashReceived: '',
                  includeTax: cart.includeTax,
                  notes: cart.notes,
                  arkToUse: 0,
                  shiftId: shift?.id || null,
                  paymentMethodCode: 'qris',
                  paymentMethodName: 'QRIS',
                  promo: promoApplied,
                  billCharges,
                  manualDiscountType: cart.manual_discount_type,
                  manualDiscountValue: cart.manual_discount_value,
                  offerDiscount,
                  offerLabels: offerEval.applied.map((a) => a.name),
                  paymentStatus: 'unpaid',
                });
                if (!res.success || !res.checkoutId) {
                  throw new Error(res.error || 'Gagal menyiapkan checkout QRIS');
                }
                return {
                  checkout_id: res.checkoutId,
                  checkout_number: res.checkoutNumber,
                  queue_number: res.queueNumber ?? null,
                };
              }
            : undefined
        }
```

Add immediately after this closing `}` (still inside the `<PaymentModal ... />` tag, as a sibling prop):

```tsx
        onPrepareOrderQris={async () => {
          // Bug #5 fix (insiden 2026-08-25): jual instan single-stall via
          // QRIS — order dibuat 'unpaid' DULU (item + stok BOM/merchandise
          // diklaim di sini, lewat endpoint open-bill yang sama dgn table
          // order), baru QR diikat ke order itu. Kalau settle gagal
          // setelah customer bayar, order tetap ADA — bukan orphan.
          const res = await openBill({
            order_type: cart.orderType as 'dine_in' | 'takeaway' | 'delivery' | 'self_order',
            customer_id: selectedCustomer?.id,
            table_id: effectiveTableId || undefined,
            guest_count: normalizeGuestCount(guestCount),
            items: cart.items.map((item) => ({
              product_id: item.productId,
              sku_id: item.skuId,
              product_name: item.name,
              product_sku: item.skuCode || item.productId,
              quantity: item.quantity,
              unit_price: item.price,
              subtotal: item.price * item.quantity,
              total_amount: item.price * item.quantity,
            })),
            subtotal: cart.subtotal,
            discount_amount: discountAmount,
            tax_amount: taxAmount,
            service_charge_amount: serviceChargeAmount,
            other_charges_amount: otherChargesAmount,
            charges_breakdown: billCharges.breakdown,
            total_amount: total,
            notes: cart.notes,
            membership_discount_pct: membershipDiscount,
            shift_id: shift?.id || undefined,
          });
          if (!res.success || !res.data?.id) {
            throw new Error(res.error || 'Gagal menyiapkan order QRIS');
          }
          return {
            order_id: res.data.id,
            order_number: res.data.order_number,
            queue_number: res.data.queue_number ?? null,
          };
        }}
        onAbandonOrderQris={async (orderId) => {
          // Bug #5 fix (insiden 2026-08-25): kasir batal QRIS sebelum bayar
          // — 'cancelled' mengembalikan stok BOM/merchandise otomatis
          // (lihat blok `if (status === 'cancelled')` di PATCH order/[id]).
          await updateOrderStatus(orderId, 'cancelled', {
            cancelled_reason: 'QRIS dibatalkan sebelum dibayar',
          }).catch((err) => {
            console.error(`[pos] abandon prepared QRIS order ${orderId} failed:`, err);
          });
        }}
```

Note: reuse the exact same source expressions already used a few lines above for `guestCount`, `discountAmount`, `taxAmount`, `serviceChargeAmount`, `otherChargesAmount`, `billCharges`, `membershipDiscount`, `total` — these are all already computed/in-scope earlier in the component render (verify each with `grep -n "const discountAmount\|const taxAmount\|const serviceChargeAmount\|const otherChargesAmount\|const total =\|const membershipDiscount" src/features/pos/cashier/components/cashier-page.tsx` before wiring; if any name differs slightly from what this task assumes, use the actual in-scope name — do not introduce a new variable).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep cashier-page`
Expected: no new errors. If `res.data.order_number` / `res.data.queue_number` report type errors, check the `Order` type at `src/lib/pos-api.ts:405-457` — both fields exist there (`order_number?: string`, `queue_number?: string | null`), so `res.data` (typed `Order`) should satisfy this without casts.

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/cashier/components/cashier-page.tsx
git commit -m "feat(pos): wire onPrepareOrderQris/onAbandonOrderQris in cashier (Bug #5)"
```

---

### Task 6: cashier-page — settle the prepared order through the open-bill payment path

**Files:**
- Modify: `src/features/pos/cashier/components/cashier-page.tsx:1303-1317` (`handleCreateOrder` overrides type)
- Modify: `src/features/pos/cashier/components/cashier-page.tsx:1741-1852` (the `if (paymentOrderId)` settle branch)
- Modify: `src/features/pos/cashier/components/cashier-page.tsx:3133-3166` (`onConfirm` handler passed to `<PaymentModal>`)

**Interfaces:**
- Consumes: `orderId`/`orderNumber` fields on the `onConfirm` payload (Task 4).
- Produces: none further — this is the terminal consumer for this plan.

- [ ] **Step 1: Accept `orderId`/`orderNumber` in `handleCreateOrder`'s overrides**

Find (around line 1303-1317):

```ts
  const handleCreateOrder = useCallback(async (overrides?: {
    method?: PaymentMethod;
    nfcTabUid?: string;
    giftCardCode?: string;
    cashReceived?: string;
    arkToUse?: number;
    checkoutId?: string;
    checkoutNumber?: string;
    queueNumber?: string | null;
    xenditQrId?: string;
    xenditExternalId?: string;
    paymentMethodCode?: string;
    paymentMethodName?: string;
    supervisorPin?: string;
  }) => {
```

Replace with:

```ts
  const handleCreateOrder = useCallback(async (overrides?: {
    method?: PaymentMethod;
    nfcTabUid?: string;
    giftCardCode?: string;
    cashReceived?: string;
    arkToUse?: number;
    checkoutId?: string;
    checkoutNumber?: string;
    queueNumber?: string | null;
    /** Bug #5 fix (insiden 2026-08-25) — order disiapkan onPrepareOrderQris. */
    orderId?: string;
    orderNumber?: string;
    xenditQrId?: string;
    xenditExternalId?: string;
    paymentMethodCode?: string;
    paymentMethodName?: string;
    supervisorPin?: string;
  }) => {
```

- [ ] **Step 2: Resolve the effective order id at the top of the function**

Find the line right after the function signature's opening guard clauses (around line 1318-1321):

```ts
    if (processingPayment) return;
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
```

Replace with:

```ts
    if (processingPayment) return;
    // Bug #5 fix (insiden 2026-08-25): order QRIS jual instan yang sudah
    // disiapkan (unpaid) TIDAK boleh dijegal oleh guard "cart kosong" —
    // cart di layar bisa saja sudah dikosongkan di render lain sementara
    // order 'unpaid'-nya masih menunggu settle. Guard cart-kosong hanya
    // relevan utk jalur create-baru (bukan settle order yang sudah ada).
    if (cart.items.length === 0 && !overrides?.orderId && !paymentOrderId) return;
    if (!requireActiveShift()) return;
```

- [ ] **Step 3: Route to the open-bill settle branch using the effective order id**

Find the start of the existing open-bill settle branch (around line 1741-1762):

```ts
    if (paymentOrderId) {
      if (promoApplied) {
        toast.error('Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu');
        setProcessingPayment(false);
        return;
      }
      const paymentMethodForApi = method === 'credit_card' ? 'credit' : method;
      const paidAmount = method === 'cash' ? (parseFloat(cashValue) || payTotal) : payTotal;
      try {
        const data = await payOpenOrderMutation.mutateAsync({
          orderId: paymentOrderId,
          payload: {
            payment_status: 'paid',
            payment_method: paymentMethodForApi,
            amount_paid: paidAmount,
            ark_coins_used: method === 'ark_coin' ? arkCapped : 0,
            xendit_qr_id: overrides?.xenditQrId,
            xendit_external_id: overrides?.xenditExternalId,
            ...catalogFields,
            ...focFields,
          },
        });
```

Replace with:

```ts
    const targetOrderId = paymentOrderId || overrides?.orderId || null;
    if (targetOrderId) {
      if (promoApplied) {
        toast.error('Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu');
        setProcessingPayment(false);
        return;
      }
      const paymentMethodForApi = method === 'credit_card' ? 'credit' : method;
      const paidAmount = method === 'cash' ? (parseFloat(cashValue) || payTotal) : payTotal;
      try {
        const data = await payOpenOrderMutation.mutateAsync({
          orderId: targetOrderId,
          payload: {
            payment_status: 'paid',
            payment_method: paymentMethodForApi,
            amount_paid: paidAmount,
            ark_coins_used: method === 'ark_coin' ? arkCapped : 0,
            xendit_qr_id: overrides?.xenditQrId,
            xendit_external_id: overrides?.xenditExternalId,
            ...catalogFields,
            ...focFields,
          },
        });
```

- [ ] **Step 4: Replace the receipt block's `paymentOrderId` reads with `targetOrderId`**

Find (immediately below Step 3's edit, around line 1764-1766):

```ts
        const receipt: ReceiptPayload = {
          orderId: paymentOrderId,
          orderNumber: payingOrderNumber || data.data?.order_number || paymentOrderId,
```

Replace with:

```ts
        const receipt: ReceiptPayload = {
          orderId: targetOrderId,
          orderNumber: payingOrderNumber || overrides?.orderNumber || data.data?.order_number || targetOrderId,
```

Do **not** change `loadedPaymentOrderRef.current = null;` (around line 1806 in this same branch) — that ref is specific to the URL-based open-bill-revisit flow and is unrelated to the freshly-prepared-order case; leave it exactly as-is.

Run: `grep -n "paymentOrderId" src/features/pos/cashier/components/cashier-page.tsx | awk -F: '$1 >= 1741 && $1 <= 1852'` and confirm the only two remaining matches in this range are the branch guard (`const targetOrderId = paymentOrderId || ...`, now on its own line just above the block) — i.e. confirm no other bare `paymentOrderId` read was missed inside this specific branch. (Note: `paymentOrderId` will still legitimately appear elsewhere in the file, e.g. its own `const paymentOrderId = searchParams.get('orderId');` declaration, and inside the *other* two `paymentOrderId`-gated branches earlier in this function around lines 1466 and 1572 for cash/other-method open-bill settlement — those are pre-existing, separate branches for non-QRIS methods and are intentionally out of scope for this plan; do not modify them.)

- [ ] **Step 5: Also clear the prepared-order reference on success**

Immediately after the line `loadedPaymentOrderRef.current = null;` inside this branch's success path (still within the same `if (targetOrderId) { ... }` block, after the receipt is stored and before `setShowPayment(false)` or equivalent cleanup — locate the exact line with `grep -n "loadedPaymentOrderRef.current = null" src/features/pos/cashier/components/cashier-page.tsx` and confirm there is exactly one occurrence inside this branch), no additional code is needed here — `PaymentModal` already resets `preparedOrderQris` itself once `open` becomes `false` is NOT guaranteed by unmount alone (state persists across the `open` prop toggling if the component instance stays mounted). Add this instead, right after `setShowPayment(false);` inside this branch:

Find:

```ts
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
```

(this exact 3-line sequence appears multiple times in the file — use the one inside the `if (targetOrderId) { ... }` block specifically, i.e. the occurrence directly below the receipt-building code identified in Step 4). Replace that one occurrence with:

```ts
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
```

No change needed here — `setShowPayment(false)` already unmounts/hides `PaymentModal` via its `open` prop, and Task 3 Step 4 already resets `preparedOrderQris` whenever `totalAfterArk` changes, which happens once `cart.clearCart()` runs on the next render. Skip this step's code change; it is a verification-only step. Run: `grep -c "setShowPayment(false)" src/features/pos/cashier/components/cashier-page.tsx` and confirm the count is unchanged from before this task (no accidental duplicate edits).

- [ ] **Step 6: Pass `orderId`/`orderNumber` through from the `onConfirm` handler**

Find (around line 3133-3166):

```tsx
        onConfirm={async ({
          method,
          cashReceived,
          arkToUse,
          nfcTabUid,
          giftCardCode,
          checkoutId,
          checkoutNumber,
          queueNumber,
          xenditQrId,
          xenditExternalId,
          paymentMethodCode,
          paymentMethodName,
          supervisorPin,
        }) => {
          setPaymentMethod(method);
          setCashReceived(cashReceived);
          setCurrentArkToUse(arkToUse);
          await handleCreateOrder({
            method,
            cashReceived,
            arkToUse,
            nfcTabUid,
            giftCardCode,
            checkoutId,
            checkoutNumber,
            queueNumber,
            xenditQrId,
            xenditExternalId,
            paymentMethodCode,
            paymentMethodName,
            supervisorPin,
          });
        }}
```

Replace with:

```tsx
        onConfirm={async ({
          method,
          cashReceived,
          arkToUse,
          nfcTabUid,
          giftCardCode,
          checkoutId,
          checkoutNumber,
          queueNumber,
          orderId,
          orderNumber,
          xenditQrId,
          xenditExternalId,
          paymentMethodCode,
          paymentMethodName,
          supervisorPin,
        }) => {
          setPaymentMethod(method);
          setCashReceived(cashReceived);
          setCurrentArkToUse(arkToUse);
          await handleCreateOrder({
            method,
            cashReceived,
            arkToUse,
            nfcTabUid,
            giftCardCode,
            checkoutId,
            checkoutNumber,
            queueNumber,
            orderId,
            orderNumber,
            xenditQrId,
            xenditExternalId,
            paymentMethodCode,
            paymentMethodName,
            supervisorPin,
          });
        }}
```

- [ ] **Step 7: Update `handleCreateOrder`'s `useCallback` dependency array**

Find the dependency array at the end of `handleCreateOrder` (search `grep -n "], \[cart, paymentMethod, selectedCustomer, cashReceived, currentArkToUse" src/features/pos/cashier/components/cashier-page.tsx` to locate it — it is a single long line). Confirm `paymentOrderId` is already listed (it is, per the existing code). No new entries are required since `overrides` is a function parameter, not a closure dependency.

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep cashier-page`
Expected: no new errors.

Run: `npx eslint src/features/pos/cashier/components/cashier-page.tsx 2>&1 | tail -30`
Expected: no new errors beyond whatever this file's pre-existing baseline is — run this same command on the unmodified file first (`git stash`, run, `git stash pop`) to establish the baseline count before judging this step's output, exactly as done for `PaymentModal.tsx` in the Bug #1–#4 work.

- [ ] **Step 9: Commit**

```bash
git add src/features/pos/cashier/components/cashier-page.tsx
git commit -m "feat(pos): settle prepared QRIS instant-sale order via open-bill path (Bug #5)"
```

---

### Task 7: Full regression + manual QA checklist

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "qris/route|webhook/route|PaymentModal|central-cashier|create-mixed-checkout|settle-order-qris|cashier-page|pos-api"
npx eslint src/components/pos/PaymentModal.tsx src/lib/pos/central-cashier.ts src/features/pos/cashier/components/cashier-page.tsx src/lib/pos-api.ts 2>&1 | tail -40
npx vitest run src/lib/pos/ src/components/pos/ 2>&1 | tail -10
```

Expected: only the documented pre-existing baseline errors/warnings (see Global Constraints); `338+5=343` or more tests passing (the 5 new `shouldPrepareOrderForQris` tests from Task 1 added to the 338 from the Bug #1–#4 hotfix branch); 0 failures.

- [ ] **Step 2: Manual QA checklist (staging, not production — this touches the primary sale path)**

Perform each scenario against a staging environment with the Xendit gateway in sandbox/test mode if available, otherwise with a real small-value QRIS transaction:

1. **Happy path, single-stall QRIS**: add 1 item to cart, select QRIS, confirm a real "Order tersimpan" row appears in `pos_orders` (`payment_status='unpaid'`) BEFORE scanning the QR (check via Orders page or DB). Pay the QR. Confirm the SAME order flips to `paid`, receipt prints, cart clears.
2. **Abandon before paying**: add items, select QRIS, let the QR render, then click "Pilih metode lain" or close the modal WITHOUT paying. Confirm the previously-created order now shows `status='cancelled'` and that any BOM/merchandise stock claimed for it has been restored (compare `inventory.inventory` quantities before/after, or check `restoreBomStockForOrder`'s audit trail table).
3. **Switch payment method after QR shown**: same as #2 but switch to "Cash" instead of closing — confirm the prepared order is cancelled and the cash payment creates a *fresh* order normally (does not reuse the cancelled one).
4. **Cart total changes while QR is showing**: add an item, select QRIS, then (before paying) go back and add another item to the cart. Confirm the OLD prepared order gets abandoned/cancelled and a NEW one is prepared with the updated total, with a fresh QR.
5. **Mixed-cart still works**: run a 2+-stall QRIS sale end-to-end, confirm no regression (this plan must not touch the `isMixedCart` branch's behavior at all).
6. **Existing open-bill payment still works**: from the Orders page, pay an already-open bill via QRIS (URL has `?orderId=...`). Confirm `payingOrderId` (not `preparedOrderQris`) drives this exactly as before.
7. **Simulated settle failure**: temporarily block `PATCH /api/pos/orders/[id]` (e.g. via browser devtools network throttling/blocking) right after a QRIS payment is confirmed at Xendit, forcing the 3 auto-retries (Bug #3) to fail and surface the "Coba lagi" error state. Confirm the order is STILL visible and findable in the Orders page as `pending`/`unpaid` with the QR's `xendit_qr_id` populated — i.e., confirm the core goal of this plan: it is no longer an untraceable orphan payment.

- [ ] **Step 3: Update the hotfix PR / merge request description**

Note in the MR description (for `hotfix/pos-qris-payment-stuck` if merged into it, or a new MR from `fix/pos-qris-instant-sale-orphan`) that this closes Bug #5 from the 2026-08-25 incident investigation: 4 confirmed orphaned QRIS payments totaling Rp77.500 with zero prior database trace; this plan makes that failure mode structurally impossible going forward (order always exists before money can be captured).
