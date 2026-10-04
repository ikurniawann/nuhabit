import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";
import { checkProductPrivileges } from "@/lib/crm/product-privilege";
import { getMemberSession } from "@/lib/member-portal/session";
import { loadMemberDiscountPercent } from "@/lib/member-portal/tier";
import { loadStaticQris } from "@/lib/payments/static-qris";
import { loadActiveXenditConfig, type XenditGatewayConfig } from "@/lib/payments/xendit";
import { calculateBillCharges } from "@/lib/pos/billing-settings";
import { allocateQueueNumber } from "@/lib/pos/queue-number";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveModifiers, resolveVariant, unitPriceFor, type SelectedModifier } from "@/lib/table-order/menu";
import { memberDiscountAmount } from "@/lib/table-order/pricing";
import { ensureOrderQris, type OrderQrisPayload } from "@/lib/table-order/qris";
import {
  clientIdentifier,
  loadProductsByIds,
  loadTableByCode,
  loadVenueContext,
  TABLE_ORDER_TAG,
  tableLabel,
} from "@/lib/table-order/server";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";
import { fireOrderAlert } from "@/lib/notifications/order-alert-server";
import { paymentMethodText } from "@/lib/table-order/order-status";
import { validateGuest, type GuestIdentity } from "@/lib/table-order/guest";

export const dynamic = "force-dynamic";

/**
 * POST /api/table-order/orders — buat order dari QR meja (publik, tanpa login kasir).
 *
 * Prinsip keamanan (QA self-order 2026-09-12):
 * - Harga, XP, dan station TIDAK dipercaya dari klien — dihitung ulang dari
 *   pos_products + varian di server. Klien hanya mengirim product_id/variant_id/qty.
 * - Pajak/service dari profil billing venue (sama dengan kasir), bukan hardcode.
 * - Member = sesi portal member (cookie OTP WhatsApp). `customer_id` dari body
 *   diabaikan; ARK Coin hanya bisa dipakai member yang login → saldo orang lain
 *   tidak bisa dibelanjakan hanya dengan tahu nomor HP-nya.
 * - QRIS: konfigurasi gateway dicek SEBELUM order dibuat; QR terikat order
 *   (reference pos-ord-<id>) sehingga webhook Xendit yang ada melunasinya.
 */

const FALLBACK_CASHIER_ID = "00000000-0000-0000-0000-000000000001";
const RATE_LIMIT_PER_MINUTE = 20;

const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().trim().max(80).nullable().optional(),
  /** Add-on terpilih; divalidasi & dihargai ulang dari katalog di server. */
  modifier_ids: z.array(z.string().uuid()).max(20).optional(),
  quantity: z.number().int().min(1).max(99),
});

const createOrderSchema = z.object({
  table_code: z.string().trim().min(1).max(80),
  order_type: z.enum(["dine_in", "takeaway"]).default("dine_in"),
  payment_method: z.enum(["qris", "static_qris", "ark_coin", "cashier"]),
  items: z.array(orderItemSchema).min(1).max(50),
  customer_note: z.string().trim().max(300).optional(),
  guest_name: z.string().trim().max(80).optional(),
  /** Wajib bila bukan member login (owner 2026-09-28) — tanpa OTP. */
  guest_phone: z.string().trim().max(30).optional(),
});

/** Link layar kasir "Buatkan Pesanan" utk notifikasi WA/Telegram (null bila URL app tak diketahui). */
function buildSelfOrderActionUrl(request: NextRequest, orderId: string) {
  const base = appOrigin(request);
  return base ? `${base}/dashboard/pos/self-orders?order=${encodeURIComponent(orderId)}` : null;
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function isGatewayConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /not configured|inactive|secret key is missing/i.test(message);
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`table-order:create:${clientIdentifier(request)}`, RATE_LIMIT_PER_MINUTE);
  if (!rate.allowed) {
    return fail("Terlalu banyak pesanan dalam waktu singkat — coba lagi sebentar", 429);
  }

  try {
    const parsed = createOrderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("Data pesanan tidak valid", 400);
    }
    const payload = parsed.data;
    const db = createPgClient();
    const arkBlocked = await rejectIfArkCoinDisabled(payload.payment_method === "ark_coin");
    if (arkBlocked) return arkBlocked;

    // Identitas member dari sesi portal (bukan dari body).
    const member = await getMemberSession().catch(() => null);
    const customerId = member?.customerId ?? null;

    if (payload.payment_method === "ark_coin" && !customerId) {
      return fail("Masuk sebagai member dulu untuk membayar dengan ARK Coin", 401);
    }

    // Tamu wajib nomor WA + nama. Nomor TIDAK ditautkan ke member (belum
    // terverifikasi) — hanya disimpan sbg kontak pesanan.
    let guest: GuestIdentity | null = null;
    if (!customerId) {
      const checked = validateGuest({ name: payload.guest_name, phone: payload.guest_phone });
      if (!checked.ok) return fail(checked.error, 400);
      guest = checked.guest;
    }

    // ---- Validasi item & hitung ulang harga dari katalog -------------------
    const products = await loadProductsByIds(payload.items.map((item) => item.product_id));
    const lines: Array<{
      product_id: string;
      product_name: string;
      product_sku: string;
      variant_name: string | null;
      modifiers: SelectedModifier[];
      quantity: number;
      unit_price: number;
      xp: number;
      station: string;
    }> = [];

    for (const item of payload.items) {
      const product = products.get(item.product_id);
      if (!product || !product.sellable) {
        return fail("Ada menu yang sudah tidak tersedia — muat ulang daftar menu", 409);
      }
      const variant = resolveVariant(product, item.variant_id ?? null);
      if (product.variants.length > 0 && !variant) {
        return fail(`Varian ${product.name} tidak dikenal — pilih ulang`, 409);
      }
      // Add-on: id harus milik produk ini & patuh batas grup; harga dari DB.
      const modifiers = resolveModifiers(product, item.modifier_ids ?? []);
      if (!modifiers.ok) return fail(modifiers.error, 409);
      lines.push({
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku.slice(0, 50),
        variant_name: variant?.name ?? null,
        modifiers: modifiers.selected,
        quantity: item.quantity,
        unit_price: unitPriceFor(product, variant, modifiers.selected),
        xp: product.xp,
        station: product.station,
      });
    }

    const privilege = await checkProductPrivileges(
      db,
      lines.map((line) => line.product_id),
      customerId
    );
    if (!privilege.allowed) {
      return fail(privilege.message || "Produk khusus member", 403);
    }

    // ---- Tagihan sesuai profil billing venue ------------------------------
    const venue = await loadVenueContext();
    const subtotal = lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
    if (subtotal <= 0) return fail("Total pesanan tidak valid", 400);
    // Diskon tier member (owner 2026-10-01: harga coret di self-order) — persen
    // dari sesi member di server, bukan dari klien. Tamu = 0.
    const memberDiscountPercent = customerId ? await loadMemberDiscountPercent(customerId) : 0;
    const discountAmount = memberDiscountAmount(subtotal, memberDiscountPercent);
    const bill = calculateBillCharges({
      subtotalAfterDiscount: subtotal - discountAmount,
      charges: venue.charges,
    });
    const total = bill.total;

    // ---- QRIS: pastikan gateway siap SEBELUM order dibuat -----------------
    let xendit: XenditGatewayConfig | null = null;
    if (payload.payment_method === "qris") {
      try {
        xendit = await loadActiveXenditConfig(db);
      } catch (error) {
        if (isGatewayConfigError(error)) {
          return fail("QRIS belum tersedia di venue ini — pilih Bayar di Kasir", 503);
        }
        throw error;
      }
    }

    // Static QRIS: order tetap unpaid; pemesan unggah bukti, kasir yang melunasi.
    if (payload.payment_method === "static_qris" && !(await loadStaticQris()).available) {
      return fail("Static QRIS belum tersedia di venue ini — pilih Bayar di Kasir", 503);
    }

    const table = await loadTableByCode(payload.table_code).catch(() => null);
    const tableId = table && table.is_active !== false ? table.id : null;
    const tableCode = payload.table_code.toUpperCase();
    const selfPaid = payload.payment_method === "ark_coin";

    // ---- ARK Coin: potong saldo atomik (RPC mengunci baris & tolak saldo kurang)
    if (selfPaid && customerId) {
      const { error: balanceError } = await db.rpc("update_ark_coin_balance", {
        p_customer_id: customerId,
        p_amount: -total,
        p_type: "payment",
        p_order_id: null,
        p_notes: `${TABLE_ORDER_TAG} ${tableCode}`,
        p_company_id: venue.companyId,
        p_branch_id: venue.branchId,
      });
      if (balanceError) {
        const insufficient = /insufficient/i.test(balanceError.message || "");
        return fail(insufficient ? "Saldo ARK Coin tidak cukup" : "Gagal memproses ARK Coin", 400);
      }
    }

    // ---- Simpan order ------------------------------------------------------
    const { data: orderNumData, error: orderNumError } = await db.rpc("generate_order_number");
    if (orderNumError) throw orderNumError;
    const orderNumber = typeof orderNumData === "string" ? orderNumData : String(orderNumData);
    const queueNumber = await allocateQueueNumber(db, venue.companyId, venue.branchId);

    const paymentStatus = selfPaid ? "paid" : "unpaid";
    const orderStatus = selfPaid ? "confirmed" : "pending";
    const noteParts = [
      `${TABLE_ORDER_TAG} ${tableCode}`,
      guest ? `Atas nama: ${guest.name} · WA ${guest.phone}` : null,
      payload.customer_note ? `Catatan: ${payload.customer_note}` : null,
    ].filter(Boolean);

    const { data: order, error: orderError } = await db
      .from("pos_orders")
      .insert({
        order_number: orderNumber,
        queue_number: queueNumber,
        order_type: payload.order_type,
        status: orderStatus,
        payment_status: paymentStatus,
        customer_id: customerId,
        cashier_id: FALLBACK_CASHIER_ID,
        table_id: tableId,
        subtotal,
        discount_amount: discountAmount,
        tax_amount: bill.tax_amount,
        service_charge_amount: bill.service_charge_amount,
        other_charges_amount: bill.other_charges_amount,
        charges_breakdown: bill.breakdown,
        total_amount: total,
        payment_method: selfPaid ? "ark_coin" : null,
        amount_paid: selfPaid ? total : 0,
        ark_coins_used: selfPaid ? total : 0,
        notes: noteParts.join(" · "),
        special_requests: `${TABLE_ORDER_TAG} ${tableCode}; payment=${payload.payment_method}`,
        ordered_at: new Date().toISOString(),
        contact_name: guest?.name ?? null,
        contact_phone: guest?.phone ?? null,
        company_id: venue.companyId,
        branch_id: venue.branchId,
      })
      .select()
      .single();

    if (orderError || !order) {
      throw orderError ?? new Error("Gagal membuat order");
    }

    const orderRow = order as Record<string, unknown> & { id: string };
    const orderId = orderRow.id;

    const orderItems = lines.map((line) => ({
      order_id: orderId,
      product_id: line.product_id,
      product_name: line.product_name,
      product_sku: line.product_sku,
      variants: line.variant_name ? [{ name: line.variant_name }] : [],
      // Bentuk sama dengan kasir ({ name, group }) supaya KDS & struk membacanya.
      modifiers: line.modifiers.map((modifier) => ({
        name: modifier.name,
        group: modifier.groupName,
        price: modifier.priceAdjustment,
      })),
      quantity: line.quantity,
      unit_price: line.unit_price,
      subtotal: line.unit_price * line.quantity,
      total_amount: line.unit_price * line.quantity,
      kitchen_notes: `${TABLE_ORDER_TAG} ${tableCode}`,
      station: line.station,
      kitchen_status: "pending",
      xp_earned: line.xp * line.quantity,
      inventory_deducted: false,
    }));

    const { error: itemsError } = await db.from("pos_order_items").insert(orderItems);
    if (itemsError) throw itemsError;

    await db.from("pos_order_status_history").insert({
      order_id: orderId,
      from_status: null,
      to_status: orderStatus,
      changed_by: FALLBACK_CASHIER_ID,
      notes: `Created from table self-service (${payload.payment_method})`,
    });

    // ---- QRIS: buat QR terikat order --------------------------------------
    let qris: OrderQrisPayload | null = null;
    let qrisError: string | null = null;
    if (xendit) {
      try {
        qris = await ensureOrderQris(
          db,
          { id: orderId, order_number: orderNumber, total_amount: total },
          xendit
        );
      } catch (error) {
        // Order tetap tersimpan sebagai open bill — pemesan diarahkan bayar di kasir.
        qrisError = error instanceof Error ? error.message : "Gagal membuat QRIS";
        console.error(`[table-order] qris create failed order=${orderId}:`, qrisError);
        await db
          .from("pos_orders")
          .update({
            special_requests: `${TABLE_ORDER_TAG} ${tableCode}; payment=cashier (qris gagal)`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);
      }
    }

    // ---- ARK Coin: efek samping pembayaran lunas --------------------------
    let crmXp: unknown = { status: "skipped", xpAwarded: 0, reason: "payment_unpaid" };
    if (selfPaid && customerId) {
      await syncPosCustomerOrderStats(db, customerId, total);
      try {
        const { postPosSaleAccountingJournals } = await import("@/lib/pos/accounting-posting");
        await postPosSaleAccountingJournals({
          db,
          orderId,
          userId: FALLBACK_CASHIER_ID,
          paymentMethod: "ark_coin",
        });
      } catch (err) {
        console.error("[table-order] accounting post error:", err);
      }
      crmXp = await awardCrmXpForPosOrder(db, {
        orderId,
        customerId,
        totalAmount: total,
        items: orderItems,
        outletId: venue.branchId,
        paymentMethod: "ark_coin",
      });
    }

    // Notifikasi staf (WA karyawan POS + Telegram) — tidak ditunggu, tidak
    // pernah menggagalkan pesanan. Nama pemesan: tamu dari form wajib,
    // member dari data pelanggan.
    let memberContact: { name: string | null; phone: string | null } | null = null;
    if (customerId) {
      const { data: customerRow } = await db
        .from("pos_customers")
        .select("name, phone")
        .eq("id", customerId)
        .maybeSingle();
      memberContact = (customerRow as { name: string | null; phone: string | null } | null) ?? null;
    }
    fireOrderAlert({
      brandName: venue.brandName,
      sourceLabel: "Self-order QR",
      tableLabel: tableLabel(tableId ? table : null, tableCode),
      orderType: payload.order_type,
      queueNumber,
      orderNumber,
      paymentLabel: paymentMethodText(qrisError ? "cashier" : payload.payment_method),
      paid: selfPaid,
      guestName: guest?.name ?? memberContact?.name ?? null,
      guestPhone: guest?.phone ?? memberContact?.phone ?? null,
      isMember: Boolean(customerId),
      actionUrl: buildSelfOrderActionUrl(request, orderId),
      customerNote: payload.customer_note || null,
      total,
      items: lines.map((line) => ({
        name: line.product_name,
        quantity: line.quantity,
        variant: line.variant_name,
        modifiers: line.modifiers.map((modifier) => modifier.name),
      })),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: orderId,
          order_number: orderNumber,
          queue_number: queueNumber,
          status: orderStatus,
          payment_status: paymentStatus,
          payment_flow: qrisError ? "cashier" : payload.payment_method,
          order_type: payload.order_type,
          table_code: tableCode,
          table_resolved: Boolean(tableId),
          subtotal,
          discount_amount: discountAmount,
          tax_amount: bill.tax_amount,
          service_charge_amount: bill.service_charge_amount,
          other_charges_amount: bill.other_charges_amount,
          total_amount: total,
          breakdown: bill.breakdown,
          total_xp: orderItems.reduce((sum, item) => sum + item.xp_earned, 0),
          items: orderItems.map((item) => ({
            product_name: item.product_name,
            variant_name: lines.find((line) => line.product_id === item.product_id)?.variant_name ?? null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_amount: item.total_amount,
            station: item.station,
          })),
          qris,
          qris_error: qrisError,
          crm_xp: crmXp,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Table order create error:", error);
    return fail(error instanceof Error ? error.message : "Gagal membuat pesanan", 500);
  }
}
