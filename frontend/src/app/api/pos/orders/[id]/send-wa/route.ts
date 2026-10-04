import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import {
  buildOrderReceiptMessage,
  normalizeWaPhone,
} from "@/lib/pos/receipt-wa";
import { formatPaymentMethodLabel } from "@/lib/pos/reports/transaction-labels";
import {
  loadPosReceiptSettingsRows,
  resolveReceiptSettings,
} from "@/lib/pos/receipt-settings";

/**
 * POST /api/pos/orders/[id]/send-wa — kirim struk digital via WhatsApp.
 *
 * Body: { phone?: string } — untuk non-member, kasir mengetik nomornya;
 * untuk member, nomor diambil dari profil pelanggan pada order.
 *
 * Isi struk dimuat ULANG dari database, bukan dipercaya dari klien — struk
 * adalah pernyataan resmi tentang uang, dan payload klien bisa saja basi
 * (mis. harga berubah oleh promo yang dievaluasi server).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id: orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as { phone?: string };
    const db = createPgClient();

    const { data: order } = await db
      .from("pos_orders")
      .select(
        `id, order_number, ordered_at, total_amount, discount_amount,
         payment_method, payment_method_code, payment_method_name, amount_paid, payment_status,
         branch_id, warehouse_id, checkout_id,
         customer:pos_customers(name, phone),
         items:pos_order_items(product_name, quantity, total_amount)`
      )
      .eq("id", orderId)
      .single();

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Order tidak ditemukan" },
        { status: 404 }
      );
    }
    if (order.payment_status !== "paid") {
      return NextResponse.json(
        { success: false, error: "Struk hanya bisa dikirim untuk order yang sudah lunas" },
        { status: 400 }
      );
    }

    const customer = order.customer as { name?: string | null; phone?: string | null } | null;
    const phone = normalizeWaPhone(body.phone ?? customer?.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor WA tidak valid — periksa kembali" },
        { status: 400 }
      );
    }

    const outlet = await queryOne<{ name: string }>(
      "SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1"
    );

    // EPIC-040: footer struk WA ikut konfigurasi, scope stall si order.
    const receiptSettings = resolveReceiptSettings(await loadPosReceiptSettingsRows(db), {
      warehouseId: (order as { warehouse_id?: string | null }).warehouse_id ?? null,
      branchId: (order as { branch_id?: string | null }).branch_id ?? null,
    });

    let items = ((order.items as Array<{
      product_name: string;
      quantity: number | string;
      total_amount: number | string;
    }>) ?? []).map((item) => ({
      name: item.product_name,
      quantity: Number(item.quantity) || 1,
      total: Number(item.total_amount) || 0,
      stallName: null as string | null,
    }));

    let total = Number(order.total_amount) || 0;
    let paid = Number(order.amount_paid) || 0;
    let discount = Number(order.discount_amount) || 0;
    let receiptNumber = String(order.order_number ?? orderId);

    // Transaksi gabungan (checkout CHK): order ini hanya SATU anak dari
    // beberapa stall. Struk harus memuat item SELURUH stall beserta total
    // gabungannya — laporan owner 2026-08-25: sebelumnya hanya item satu
    // stall yang terkirim sehingga struk pelanggan tidak lengkap.
    const checkoutId = (order as { checkout_id?: string | null }).checkout_id;
    if (checkoutId) {
      const family = await query<{
        id: string;
        order_number: string | null;
        total_amount: string | number | null;
        discount_amount: string | number | null;
        amount_paid: string | number | null;
        stall_name: string | null;
      }>(
        `SELECT o.id, o.order_number, o.total_amount, o.discount_amount,
                o.amount_paid, w.name AS stall_name
           FROM pos.pos_orders o
           LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
          WHERE o.checkout_id = $1
            AND o.status NOT IN ('cancelled', 'voided', 'merged')
          ORDER BY o.order_number`,
        [checkoutId]
      );

      if (family.length > 1) {
        const familyIds = family.map((row) => row.id);
        const familyItems = await query<{
          order_id: string;
          product_name: string | null;
          quantity: string | number | null;
          total_amount: string | number | null;
        }>(
          `SELECT order_id, product_name, quantity, total_amount
             FROM pos.pos_order_items
            WHERE order_id = ANY($1::uuid[])
            ORDER BY order_id, id`,
          [familyIds]
        );
        const stallById = new Map(family.map((row) => [row.id, row.stall_name]));

        items = familyItems.map((item) => ({
          name: item.product_name || "Item",
          quantity: Number(item.quantity) || 1,
          total: Number(item.total_amount) || 0,
          stallName: stallById.get(item.order_id) ?? null,
        }));
        const sum = (pick: (r: (typeof family)[number]) => unknown) =>
          family.reduce((acc, row) => acc + (Number(pick(row)) || 0), 0);
        total = sum((r) => r.total_amount);
        discount = sum((r) => r.discount_amount);
        paid = sum((r) => r.amount_paid);

        const checkout = await queryOne<{ checkout_number: string | null }>(
          `SELECT checkout_number FROM pos.pos_checkouts WHERE id = $1`,
          [checkoutId]
        );
        if (checkout?.checkout_number) receiptNumber = checkout.checkout_number;
      }
    }

    const message = buildOrderReceiptMessage({
      outletName: outlet?.name ?? "Kasir",
      orderNumber: receiptNumber,
      orderedAt: String(order.ordered_at ?? new Date().toISOString()),
      items,
      total,
      paymentMethod: formatPaymentMethodLabel(order.payment_method, {
        code: order.payment_method_code,
        name: order.payment_method_name,
      }),
      change: Math.max(0, paid - total),
      discountAmount: discount,
      customerName: customer?.name ?? null,
      footerLines: receiptSettings.footer_lines,
    });

    const result = await sendWhatsAppText(
      { target: phone, message },
      { messageType: "notification", sentByUserId: sessionUserId }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim WA" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, data: { phone } });
  } catch (error) {
    console.error("[pos:send-wa] gagal:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim struk" },
      { status: 500 }
    );
  }
}
