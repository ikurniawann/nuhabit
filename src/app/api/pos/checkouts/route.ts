import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { validateKolComp } from "@/lib/pos/comp-orders-server";
import { isFocPaymentMethod } from "@/lib/pos/payment-methods";
import { approveWithSupervisorPin, supervisorPinRejection } from "@/lib/pos/supervisor-pin-server";
import { notifyCompTransaction } from "@/lib/wa/comp-notification";
import { getApiUserScope } from "@/lib/api/scope";
import { checkProductPrivileges } from "@/lib/crm/product-privilege";
import { createPgClient } from "@/lib/pg/create-client";
import { canSellMixedStall } from "@/lib/pos/central-cashier";
import {
  MixedCheckoutError,
  createMixedCheckout,
  guardMixedCheckoutCart,
  type MixedCheckoutItem,
} from "@/lib/pos/create-mixed-checkout";
import {
  loadCentralCashierGate,
  loadPosProductWarehouseIds,
} from "@/lib/pos/pos-sell-stall-server";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Kasir dari SESI (hris.employees.user_id) — sama dengan POST /api/pos/orders.
 * Nilai kiriman klien hanya dipakai bila bukan dummy; dulu stub ini selalu
 * mengembalikan dummy sehingga semua anak-order checkout tercatat "Kasir: —".
 */
const FALLBACK_CASHIER_ID = "00000000-0000-0000-0000-000000000001";

async function resolveCashierId(
  sessionUserId: string,
  clientCashierId?: string | null
): Promise<string> {
  const { queryOne } = await import("@/lib/db");
  const employee = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees WHERE user_id = $1 LIMIT 1`,
    [sessionUserId]
  ).catch(() => null);
  if (employee?.id) return employee.id;
  if (clientCashierId && clientCashierId !== FALLBACK_CASHIER_ID) return clientCashierId;
  return FALLBACK_CASHIER_ID;
}

type CheckoutBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  guest_count?: number | string;
  items?: Array<Record<string, unknown>>;
  discount_amount?: number | string;
  discount_reason?: string;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  payment_method?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  payment_status?: string;
  amount_paid?: number | string;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number | string;
  promo_code?: string;
  splits?: unknown[];
  branch_id?: string;
  shift_id?: string;
  /** EPIC-043 — 'kol_comp': komplimen KOL utk checkout multi-stall. */
  comp_type?: string;
  /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
  supervisor_pin?: string;
};

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CheckoutBody;
    const arkBlocked = await rejectIfArkCoinDisabled(
      body.payment_method === "ark_coin" || Number(body.ark_coins_used) > 0
    );
    if (arkBlocked) return arkBlocked;
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Items and total amount are required" },
        { status: 400 }
      );
    }

    const productIds = items.map((item) => String(item.product_id || ""));
    const warehouseByProduct = await loadPosProductWarehouseIds(productIds);
    const scope = await getApiUserScope();
    const gate = await loadCentralCashierGate({
      userId: sessionUserId,
      role: scope?.role ?? null,
    });
    const mixedGuard = guardMixedCheckoutCart({
      productIds,
      warehouseByProduct,
      canSellMixed: canSellMixedStall({
        hasCentralMenu: gate.hasCentralMenu,
        canCentralCheckout: gate.canCentralCheckout,
        activeMode: gate.activeMode,
      }),
      hasSplits: Array.isArray(body.splits) && body.splits.length > 0,
      promoCode: body.promo_code,
    });
    if (!mixedGuard.ok) {
      return NextResponse.json({ success: false, error: mixedGuard.message }, { status: 400 });
    }
    if (!mixedGuard.createCheckout) {
      return NextResponse.json(
        { success: false, error: "Checkout multi-stall membutuhkan item dari minimal 2 stall" },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const privilege = await checkProductPrivileges(db, productIds, body.customer_id);
    if (!privilege.allowed) {
      return NextResponse.json({ success: false, error: privilege.message }, { status: 403 });
    }

    // EPIC-043: komplimen KOL utk checkout multi-stall — validasi server
    // (flag is_kol + kuota) sebelum checkout dibuat; total harus 0.
    let compType: string | null = null;
    if (body.comp_type != null && String(body.comp_type) !== "") {
      if (String(body.comp_type) !== "kol_comp") {
        return NextResponse.json(
          { success: false, error: "comp_type tidak dikenal utk checkout" },
          { status: 400 }
        );
      }
      if (!body.customer_id) {
        return NextResponse.json(
          { success: false, error: "Komplimen KOL membutuhkan customer" },
          { status: 400 }
        );
      }
      const gross = items.reduce(
        (sum, item) => sum + (Number(item.subtotal ?? item.total_amount) || 0),
        0
      );
      if ((Number(body.total_amount) || 0) > 0.5) {
        return NextResponse.json(
          { success: false, error: "Komplimen KOL harus menggratiskan seluruh order (total 0)" },
          { status: 400 }
        );
      }
      const kol = await validateKolComp({ customerId: body.customer_id, grossIdr: gross });
      if (!kol.ok) {
        return NextResponse.json({ success: false, error: kol.reason }, { status: 403 });
      }
      compType = "kol_comp";
    }

    // Metode FOC (Free of Charge) — keputusan owner 2026-08-24: checkout
    // dengan metode FOC wajib disetujui PIN supervisor; penyetuju dicatat.
    let compApproved: { id: string; name: string } | null = null;
    if (isFocPaymentMethod(body.payment_method_code, body.payment_method_name)) {
      // Keputusan owner 2026-08-24: FOC WAJIB ber-customer/member.
      if (!body.customer_id) {
        return NextResponse.json(
          { success: false, error: "Metode FOC membutuhkan customer/member — pilih customer dulu" },
          { status: 400 }
        );
      }
      const pin = String(body.supervisor_pin || "").trim();
      if (!pin) {
        return NextResponse.json(
          { success: false, error: "Metode FOC membutuhkan PIN supervisor" },
          { status: 400 }
        );
      }
      const approval = await approveWithSupervisorPin({ callerId: sessionUserId, pin });
      if (!approval.ok) return supervisorPinRejection(approval);
      compApproved = approval.supervisor;
    }

    // FOC = komplimen: pendapatan diakui 0 — diskon 100% dari gross item,
    // pajak/service digugurkan, total & dibayar 0, comp_type foc_comp
    // distempel ke checkout + seluruh anak-order.
    const focOverrides = compApproved
      ? {
          discountAmount: items.reduce(
            (sum, item) => sum + (Number(item.subtotal ?? item.total_amount) || 0),
            0
          ),
          discountReason: "FOC",
          taxAmount: 0,
          serviceChargeAmount: 0,
          otherChargesAmount: 0,
          totalAmount: 0,
          amountPaid: 0,
          compType: "foc_comp",
        }
      : null;

    const result = await createMixedCheckout({
      items: items as MixedCheckoutItem[],
      warehouseByProduct,
      orderType: body.order_type,
      customerId: body.customer_id,
      cashierId: await resolveCashierId(sessionUserId, body.cashier_id),
      serverId: body.server_id,
      tableId: body.table_id,
      guestCount: body.guest_count,
      discountAmount: body.discount_amount,
      discountReason: body.discount_reason,
      promoCode: body.promo_code,
      taxAmount: body.tax_amount,
      serviceChargeAmount: body.service_charge_amount,
      otherChargesAmount: body.other_charges_amount,
      chargesBreakdown: body.charges_breakdown,
      totalAmount: body.total_amount,
      paymentMethod: body.payment_method,
      paymentMethodCode: body.payment_method_code,
      paymentMethodName: body.payment_method_name,
      paymentStatus: body.payment_status,
      amountPaid: body.amount_paid,
      arkCoinsUsed: body.ark_coins_used,
      notes: body.notes,
      specialRequests: body.special_requests,
      companyId: scope?.companyId,
      branchId: body.branch_id || scope?.branchId,
      shiftId: body.shift_id,
      sessionUserId,
      compType,
      compApproved,
      ...(focOverrides ?? {}),
    });

    // Notifikasi WA owner (2026-08-24): setiap FOC yang disetujui dikabarkan.
    if (compApproved && focOverrides) {
      void notifyCompTransaction({
        compType: "foc_comp",
        orderNumber: result.checkoutNumber,
        orderCount: result.orderIds.length || undefined,
        grossIdr: focOverrides.discountAmount,
        approvedName: compApproved.name,
        customerId: body.customer_id || null,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          checkout_id: result.checkoutId,
          checkout_number: result.checkoutNumber,
          queue_number: result.queueNumber,
          order_ids: result.orderIds,
          comp_approved_name: compApproved?.name ?? null,
        },
        // EPIC-041: snapshot ARK/XP utk struk — dibaca use-pos-checkout dari
        // level atas respons (sama seperti POST /api/pos/orders).
        ark_balance_after: result.arkBalanceAfter ?? null,
        xp_total_after: result.xpTotalAfter ?? null,
        crm_xp: result.xpAwarded ? { xpAwarded: result.xpAwarded } : null,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("[pos] create checkout error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
