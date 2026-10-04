// Pelunasan checkout gabungan yang tersimpan (tagihan meja / QRIS / webhook).
import { withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import {
  getXenditQrCode,
  getXenditQrCodeByReferenceId,
  getXenditQrPayments,
  isXenditQrPaid,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import {
  claimMerchandiseStock,
  restoreMerchandiseStock,
  type MerchStockClaim,
} from "@/lib/pos/merchandise-stock";
import { resolvePaymentCatalogStamp } from "@/lib/pos/payment-methods";
import { loadPosProductCostMap } from "@/lib/pos/purchasing-sync";
import { insertChildrenForCheckout } from "./children";
import { finalizePaidChildren } from "./finalize";
import {
  allocateCheckoutTender,
  assertCheckoutQrisReadyToComplete,
  mustConfirmStoredCheckoutQris,
  parseSnapshot,
  resolveCheckoutBillTender,
  resolveCompleteCheckoutTender,
  toNumber,
} from "./rules";
import { isMissingColumn, loadCheckoutForUpdate, stampPaymentCatalog } from "./rows";
import {
  MixedCheckoutError,
  type CheckoutRow,
  type CompleteMixedCheckoutOptions,
  type CompleteMixedCheckoutTender,
} from "./types";

type PgClient = ReturnType<typeof createPgClient>;
type ExistingChild = { id: string; total: number; subtotal: number };
type CheckoutPreview = Pick<
  CheckoutRow,
  | "id"
  | "customer_id"
  | "cashier_id"
  | "payment_method"
  | "payment_method_code"
  | "payment_method_name"
  | "branch_id"
  | "cart_snapshot"
  | "xendit_qr_id"
  | "xendit_external_id"
  | "total_amount"
>;
type ResolvedTender = { paymentMethod: string; amountPaid: number; changeAmount: number };
type CatalogStamp = ReturnType<typeof resolvePaymentCatalogStamp>;

async function confirmStoredCheckoutQrisPaid(input: {
  xenditQrId?: string | null;
  xenditExternalId?: string | null;
}) {
  const hasQr = assertCheckoutQrisReadyToComplete({
    xenditQrId: input.xenditQrId,
    xenditExternalId: input.xenditExternalId,
    paid: true,
  });
  if (!hasQr.ok) {
    throw new MixedCheckoutError(hasQr.message, 409);
  }

  const xendit = await loadActiveXenditConfig();
  let qrId = String(input.xenditQrId || "");
  let remote: Record<string, unknown>;
  if (qrId) {
    remote = await getXenditQrCode(xendit.secretKey, qrId);
  } else {
    remote = await getXenditQrCodeByReferenceId(
      xendit.secretKey,
      String(input.xenditExternalId)
    );
    qrId = String(remote.id || "");
  }

  let paid = isXenditQrPaid(remote);
  if (!paid && qrId) {
    try {
      const payments = await getXenditQrPayments(xendit.secretKey, qrId);
      paid = isXenditQrPaid({ payments });
    } catch {
      // payments endpoint is optional; QR detail may already be enough
    }
  }

  const ready = assertCheckoutQrisReadyToComplete({
    xenditQrId: input.xenditQrId || qrId,
    xenditExternalId: input.xenditExternalId,
    paid,
  });
  if (!ready.ok) {
    throw new MixedCheckoutError(ready.message, 409);
  }
}

async function loadCompletionContext(db: PgClient, checkoutId: string) {
  const existing = await db
    .from("pos_orders")
    .select("id, total_amount, subtotal")
    .eq("checkout_id", checkoutId);
  const children: ExistingChild[] = ((existing.data || []) as Array<{
    id: string;
    total_amount?: string | number | null;
    subtotal?: string | number | null;
  }>).map((row) => ({
    id: String(row.id),
    total: toNumber(row.total_amount),
    subtotal: toNumber(row.subtotal),
  }));

  const { data: preview, error: previewError } = await db
    .from("pos_checkouts")
    .select(
      "id, customer_id, cashier_id, payment_method, payment_method_code, payment_method_name, branch_id, cart_snapshot, xendit_qr_id, xendit_external_id, total_amount"
    )
    .eq("id", checkoutId)
    .maybeSingle();
  if (previewError) throw previewError;
  if (!preview) {
    throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
  }
  return { children, preview: preview as CheckoutPreview };
}

/**
 * Open bill yang anak-ordernya sudah ada: tandai checkout & tiap anak lunas
 * (tender dibagi pro-rata, kembalian di anak pertama). FOC menggratiskan
 * semuanya: diskon 100% dari gross, sama seperti Owner Comp.
 */
async function payExistingChildren(
  db: PgClient,
  input: {
    checkoutId: string;
    children: ExistingChild[];
    preview: CheckoutPreview;
    resolved: ResolvedTender;
    catalog: CatalogStamp;
    compApproved?: CompleteMixedCheckoutTender["compApproved"];
  }
) {
  const { checkoutId, children, preview, resolved, catalog, compApproved } = input;
  const now = new Date().toISOString();
  const focGross = children.reduce((sum, row) => sum + (row.subtotal || row.total), 0);
  const { error: payCheckoutErr } = await db
    .from("pos_checkouts")
    .update({
      payment_status: "paid",
      payment_method: resolved.paymentMethod,
      amount_paid: compApproved ? 0 : resolved.amountPaid,
      change_amount: compApproved ? 0 : resolved.changeAmount,
      ...(compApproved ? { discount_amount: focGross, total_amount: 0 } : {}),
      ...catalog,
      updated_at: now,
    })
    .eq("id", checkoutId)
    .neq("payment_status", "paid");
  if (payCheckoutErr) throw payCheckoutErr;

  const paidParts = allocateCheckoutTender(
    resolved.amountPaid,
    children.map((row) => row.total)
  );
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    const { error: payChildErr } = await db
      .from("pos_orders")
      .update({
        payment_status: "paid",
        payment_method: resolved.paymentMethod,
        amount_paid: compApproved ? 0 : (paidParts[index] ?? 0),
        change_amount: compApproved ? 0 : index === 0 ? resolved.changeAmount : 0,
        xendit_qr_id: preview.xendit_qr_id || null,
        xendit_external_id: preview.xendit_external_id || null,
        ...catalog,
        ...(compApproved
          ? {
              discount_amount: child.subtotal || child.total,
              discount_reason: "FOC",
              total_amount: 0,
              comp_type: "foc_comp",
              comp_approved_by: compApproved.id,
              comp_approved_name: compApproved.name,
            }
          : {}),
        updated_at: now,
      })
      .eq("id", child.id)
      .neq("payment_status", "paid");
    if (payChildErr) throw payChildErr;
  }
}

/**
 * Checkout tanpa anak: dalam SATU transaksi kunci checkout, tandai lunas
 * (FOC: digratiskan), klaim stok merch, lalu sisipkan anak-order dari
 * snapshot. Bila anak ternyata sudah ada saat dikunci, pakai yang ada.
 */
function settleAndInsertChildren(
  db: PgClient,
  input: {
    checkoutId: string;
    resolved: ResolvedTender;
    catalog: CatalogStamp;
    compApproved?: CompleteMixedCheckoutTender["compApproved"];
    onMerchClaimed: (claims: MerchStockClaim[]) => void;
  }
) {
  const { checkoutId, resolved, catalog, compApproved } = input;
  return withTransaction(async (client) => {
    const checkout = await loadCheckoutForUpdate(client, checkoutId);
    if (!checkout) {
      throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
    }
    const already = await client.query<{ id: string }>(
      `SELECT id FROM pos.pos_orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    if (already.rows.length > 0) {
      return {
        orderIds: already.rows.map((row) => row.id),
        snapshot: parseSnapshot(checkout),
        checkout,
        reusedExistingChildren: true,
      };
    }

    const snapshot = parseSnapshot(checkout);
    if (!snapshot?.items?.length) {
      throw new MixedCheckoutError("Checkout tidak punya item untuk diselesaikan", 409);
    }

    // FOC: diskon 100% dari gross item snapshot, pajak/service gugur, total & dibayar 0.
    const focSnapshotGross = compApproved
      ? snapshot.items.reduce((sum, item) => {
          const line = item as { subtotal?: unknown; total_amount?: unknown };
          return sum + toNumber(line.subtotal ?? line.total_amount);
        }, 0)
      : 0;
    if (compApproved) {
      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             payment_method = $2::pos_payment_method,
             amount_paid = 0,
             change_amount = 0,
             discount_amount = $3,
             tax_amount = 0,
             service_charge_amount = 0,
             other_charges_amount = 0,
             total_amount = 0,
             updated_at = now()
         WHERE id = $1`,
        [checkoutId, resolved.paymentMethod, focSnapshotGross]
      );
    } else {
      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             payment_method = $2::pos_payment_method,
             amount_paid = $3,
             change_amount = $4,
             updated_at = now()
         WHERE id = $1`,
        [checkoutId, resolved.paymentMethod, resolved.amountPaid, resolved.changeAmount]
      );
    }

    const merchClaimResult = await claimMerchandiseStock(db, snapshot.items);
    if (!merchClaimResult.ok) {
      throw new MixedCheckoutError(merchClaimResult.reason, merchClaimResult.status);
    }
    input.onMerchClaimed(merchClaimResult.claims);
    const costMap = await loadPosProductCostMap(
      db,
      snapshot.items.map((item) => String(item.product_id || "")).filter(Boolean)
    );
    const settledCheckout = {
      ...checkout,
      payment_status: "paid",
      payment_method: resolved.paymentMethod,
      amount_paid: compApproved ? 0 : resolved.amountPaid,
      change_amount: compApproved ? 0 : resolved.changeAmount,
      ...(compApproved
        ? {
            discount_amount: focSnapshotGross,
            tax_amount: 0,
            service_charge_amount: 0,
            other_charges_amount: 0,
            total_amount: 0,
          }
        : {}),
    };
    const orderIds = await insertChildrenForCheckout(client, {
      checkout: settledCheckout,
      snapshot,
      isOpenBill: Boolean(checkout.table_id),
      warehouseByProduct: new Map(Object.entries(snapshot.warehouseByProduct || {})),
      merchClaimedIds: new Set(merchClaimResult.claims.map((claim) => claim.productId)),
      costMap,
      compType: compApproved ? "foc_comp" : null,
      compApproved: compApproved ?? null,
    });
    if (checkout.xendit_qr_id || checkout.xendit_external_id) {
      try {
        await client.query(
          `UPDATE pos.pos_orders
           SET xendit_qr_id = $2, xendit_external_id = $3, updated_at = now()
           WHERE checkout_id = $1`,
          [checkoutId, checkout.xendit_qr_id || null, checkout.xendit_external_id || null]
        );
      } catch (error) {
        if (!isMissingColumn(error)) throw error;
      }
    }
    await stampPaymentCatalog(client, {
      checkoutId,
      orderIds,
      code: catalog.payment_method_code || checkout.payment_method_code,
      name: catalog.payment_method_name || checkout.payment_method_name,
    });
    return { orderIds, snapshot, checkout: settledCheckout, reusedExistingChildren: false };
  });
}

export async function completeMixedCheckout(
  checkoutId: string,
  tender: CompleteMixedCheckoutTender = {},
  options: CompleteMixedCheckoutOptions = {}
): Promise<{ orderIds: string[] }> {
  const db = createPgClient();
  const { children, preview } = await loadCompletionContext(db, checkoutId);

  const childTotal = children.reduce((sum, row) => sum + row.total, 0);
  const totalAmount = toNumber(preview.total_amount) || childTotal;
  const storedTender = resolveCompleteCheckoutTender({
    tender,
    storedPaymentMethod: preview.payment_method,
    totalAmount,
  });
  const resolved = resolveCheckoutBillTender({
    paymentMethod: storedTender.paymentMethod,
    amountPaid: storedTender.amountPaid,
    totalAmount,
  });
  if (!resolved.ok) {
    throw new MixedCheckoutError(resolved.message);
  }

  const catalog = resolvePaymentCatalogStamp({
    code: tender.paymentMethodCode || preview.payment_method_code,
    name: tender.paymentMethodName || preview.payment_method_name,
  });

  if (
    mustConfirmStoredCheckoutQris({
      paymentMethod: resolved.paymentMethod,
      paymentAlreadyConfirmed: options.paymentAlreadyConfirmed,
      hasExistingChildren: children.length > 0,
    })
  ) {
    await confirmStoredCheckoutQrisPaid({
      xenditQrId: preview.xendit_qr_id,
      xenditExternalId: preview.xendit_external_id,
    });
  }

  if (children.length > 0) {
    await payExistingChildren(db, {
      checkoutId,
      children,
      preview,
      resolved,
      catalog,
      compApproved: tender.compApproved,
    });
    const orderIds = children.map((row) => row.id);
    await finalizePaidChildren({
      orderIds,
      customerId: preview.customer_id,
      sessionUserId: parseSnapshot(preview)?.sessionUserId || String(preview.cashier_id || ""),
      paymentMethod: resolved.paymentMethod,
      branchId: preview.branch_id,
      alreadyHadChildren: true,
    });
    return { orderIds };
  }

  let merchClaims: MerchStockClaim[] = [];
  try {
    const created = await settleAndInsertChildren(db, {
      checkoutId,
      resolved,
      catalog,
      compApproved: tender.compApproved,
      onMerchClaimed: (claims) => {
        merchClaims = claims;
      },
    });

    merchClaims = [];
    await finalizePaidChildren({
      orderIds: created.orderIds,
      customerId: created.checkout.customer_id,
      sessionUserId: created.snapshot?.sessionUserId || created.checkout.cashier_id,
      paymentMethod: created.checkout.payment_method || resolved.paymentMethod,
      branchId: created.checkout.branch_id,
      alreadyHadChildren: created.reusedExistingChildren,
    });
    return { orderIds: created.orderIds };
  } catch (error) {
    if (merchClaims.length > 0) {
      await restoreMerchandiseStock(db, merchClaims).catch((restoreErr) =>
        console.error("[pos] complete mixed merch restore failed:", restoreErr)
      );
    }
    throw error;
  }
}
