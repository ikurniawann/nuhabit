import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPgClient } from "@/lib/pg/create-client";
import {
  createXenditDynamicQr,
  getXenditQrCode,
  getXenditQrCodeByReferenceId,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { resolveCheckoutQrisAction } from "@/lib/pos/create-mixed-checkout";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { formatRupiah } from "@/lib/format";

// QRIS dinamis utk customer display: QR per transaksi dengan nominal terkunci.
// Secret diambil dari Settings → Payment Gateways (configuration.payment_gateways),
// sama seperti topup — bukan XENDIT_SECRET_KEY di env.

const createSchema = z.object({
  amount: z.number().positive().max(999_999_999).optional(),
  checkout_id: z.string().uuid().optional(),
  // Insiden 2026-08-23: bayar open bill — QR terikat order, nominal dipaksa
  // dari total bill TERSIMPAN (keranjang layar bisa menyimpang dari DB).
  order_id: z.string().uuid().optional(),
}).refine(
  (value) => value.amount != null || Boolean(value.checkout_id) || Boolean(value.order_id),
  { message: "Nominal tidak valid" }
);

function isGatewayConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /not configured|inactive|secret key is missing/i.test(message);
}

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const rate = checkRateLimit(`pos-qris:${sessionUserId}`, 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan QR — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Nominal tidak valid" },
        { status: 400 }
      );
    }

    const db = createPgClient();

    let amount = parsed.data.amount;
    let referenceId = `pos-${randomUUID()}`;
    const checkoutId = parsed.data.checkout_id;
    const orderId = !checkoutId ? parsed.data.order_id : undefined;

    // Validasi bill dilakukan SEBELUM memuat gateway: selisih nominal harus
    // ketahuan duluan, bukan tersembunyi di balik error konfigurasi Xendit.
    // Baris QRIS-nya sendiri (reuse vs create) dikeputuskan SETELAH gateway
    // dimuat — lihat blok di bawah, simetris dengan pola checkout.
    let orderRow: {
      id: string;
      order_number: string | null;
      total_amount: number | string | null;
      xendit_qr_id: string | null;
      xendit_external_id: string | null;
    } | null = null;
    if (orderId) {
      const { data: order, error: orderError } = await db
        .from("pos_orders")
        .select("id, order_number, total_amount, payment_status, xendit_qr_id, xendit_external_id")
        .eq("id", orderId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) {
        return NextResponse.json(
          { success: false, error: "Order tidak ditemukan" },
          { status: 404 }
        );
      }
      if (String(order.payment_status) === "paid") {
        return NextResponse.json(
          { success: false, error: `Bill ${order.order_number || ""} sudah lunas` },
          { status: 400 }
        );
      }
      const orderTotal = Number(order.total_amount) || 0;
      if (orderTotal <= 0) {
        return NextResponse.json(
          { success: false, error: "Nominal tidak valid" },
          { status: 400 }
        );
      }
      // Nominal dari klien hanya boleh MENGONFIRMASI total tersimpan.
      // Selisih = keranjang layar tidak sama dengan bill di sistem.
      if (amount != null && Math.abs(amount - orderTotal) > 1) {
        return NextResponse.json(
          {
            success: false,
            error: `Total di layar (${formatRupiah(amount)}) tidak sama dengan bill tersimpan ${order.order_number || ""} (${formatRupiah(orderTotal)}) — muat ulang bill sebelum menagih QRIS`,
          },
          { status: 409 }
        );
      }
      amount = orderTotal;
      orderRow = order;
    }

    let xendit;
    try {
      xendit = await loadActiveXenditConfig(db);
    } catch (err) {
      const message = err instanceof Error ? err.message : "QRIS belum dikonfigurasi";
      console.error("[pos] qris gateway config:", message);
      if (isGatewayConfigError(err)) {
        return NextResponse.json(
          { success: false, error: message },
          { status: 503 }
        );
      }
      throw err;
    }

    // Bug #1 fix (insiden 2026-08-25): QR order sebelumnya SELALU dibuat baru
    // dengan reference_id deterministik (pos-ord-${orderId}), tanpa cek QR
    // yang sudah ada — beda dgn checkout di bawah yang sudah reuse. Efeknya:
    // begitu effect layar kasir re-run (mis. totalAfterArk goyang sedikit
    // krn floating point/diskon), endpoint ini dipanggil ulang, Xendit
    // menolak reference_id duplikat, dan bill nyangkut tanpa QR yang valid.
    // Pola reuse sekarang disamakan persis dengan checkout.
    if (orderId && orderRow) {
      const qrisAction = resolveCheckoutQrisAction({
        xendit_qr_id: orderRow.xendit_qr_id,
        xendit_external_id: orderRow.xendit_external_id,
      });
      let reusedOrderQr: Awaited<ReturnType<typeof getXenditQrCode>> | null = null;
      if (qrisAction !== "create") {
        try {
          reusedOrderQr =
            qrisAction === "reuse_qr_id"
              ? await getXenditQrCode(xendit.secretKey, String(orderRow.xendit_qr_id))
              : await getXenditQrCodeByReferenceId(
                  xendit.secretKey,
                  String(orderRow.xendit_external_id)
                );
        } catch (lookupErr) {
          // QA 2026-08-25: reservasi lama (xendit_external_id tersimpan) tapi
          // QR-nya sendiri gagal terbentuk di Xendit (mis. koneksi putus
          // tepat setelah reservasi) — reuse lookup akan SELALU gagal &
          // bill nyangkut permanen kalau berhenti di sini. Anggap reservasi
          // basi, lanjut ke jalur create baru di bawah.
          console.warn(
            `[pos] qris reuse lookup miss, falling back to create: order=${orderId}`,
            lookupErr instanceof Error ? lookupErr.message : lookupErr
          );
        }
      }
      if (reusedOrderQr) {
        if (qrisAction === "lookup_external_id" && reusedOrderQr.id && !orderRow.xendit_qr_id) {
          const { error: healError } = await db
            .from("pos_orders")
            .update({
              xendit_qr_id: reusedOrderQr.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", orderId);
          if (healError) {
            return NextResponse.json(
              { success: false, error: "Gagal menyimpan QRIS order" },
              { status: 500 }
            );
          }
        }
        return NextResponse.json({
          success: true,
          data: {
            qr_id: String(reusedOrderQr.id || orderRow.xendit_qr_id || ""),
            reference_id: String(
              (reusedOrderQr as { reference_id?: unknown }).reference_id ||
                orderRow.xendit_external_id ||
                ""
            ),
            qr_string: String((reusedOrderQr as { qr_string?: unknown }).qr_string || ""),
            amount:
              Number(
                (reusedOrderQr as { amount?: unknown }).amount != null
                  ? (reusedOrderQr as { amount?: unknown }).amount
                  : amount
              ) || amount,
            expires_at: (reusedOrderQr as { expires_at?: unknown }).expires_at
              ? String((reusedOrderQr as { expires_at?: unknown }).expires_at)
              : null,
            order_id: orderId,
          },
        });
      }

      referenceId = `pos-ord-${orderId}`;
      const { error: reserveError } = await db
        .from("pos_orders")
        .update({
          xendit_external_id: referenceId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      if (reserveError) {
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS order" },
          { status: 500 }
        );
      }
    }

    if (checkoutId) {
      const { data: checkout, error: checkoutError } = await db
        .from("pos_checkouts")
        .select("id, total_amount, xendit_qr_id, xendit_external_id, payment_status")
        .eq("id", checkoutId)
        .maybeSingle();
      if (checkoutError) throw checkoutError;
      if (!checkout) {
        return NextResponse.json(
          { success: false, error: "Checkout tidak ditemukan" },
          { status: 404 }
        );
      }

      const checkoutTotal = Number(checkout.total_amount) || 0;
      if (checkoutTotal <= 0) {
        return NextResponse.json(
          { success: false, error: "Nominal tidak valid" },
          { status: 400 }
        );
      }
      if (amount != null && Math.abs(amount - checkoutTotal) > 1) {
        return NextResponse.json(
          { success: false, error: "Nominal QRIS harus sama dengan total checkout" },
          { status: 400 }
        );
      }
      amount = checkoutTotal;

      const qrisAction = resolveCheckoutQrisAction({
        xendit_qr_id: checkout.xendit_qr_id,
        xendit_external_id: checkout.xendit_external_id,
      });
      let reusedCheckoutQr: Awaited<ReturnType<typeof getXenditQrCode>> | null = null;
      if (qrisAction !== "create") {
        try {
          reusedCheckoutQr =
            qrisAction === "reuse_qr_id"
              ? await getXenditQrCode(xendit.secretKey, String(checkout.xendit_qr_id))
              : await getXenditQrCodeByReferenceId(
                  xendit.secretKey,
                  String(checkout.xendit_external_id)
                );
        } catch (lookupErr) {
          // QA 2026-08-25: sama seperti order — reservasi lama bisa basi
          // kalau pembuatan QR sebelumnya gagal network setelah reservasi
          // tersimpan. Jangan deadlock permanen; lanjut ke jalur create baru.
          console.warn(
            `[pos] qris reuse lookup miss, falling back to create: checkout=${checkoutId}`,
            lookupErr instanceof Error ? lookupErr.message : lookupErr
          );
        }
      }
      if (reusedCheckoutQr) {
        if (qrisAction === "lookup_external_id" && reusedCheckoutQr.id && !checkout.xendit_qr_id) {
          const { error: healError } = await db
            .from("pos_checkouts")
            .update({
              xendit_qr_id: reusedCheckoutQr.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", checkoutId);
          if (healError) {
            return NextResponse.json(
              { success: false, error: "Gagal menyimpan QRIS checkout" },
              { status: 500 }
            );
          }
        }
        return NextResponse.json({
          success: true,
          data: {
            qr_id: String(reusedCheckoutQr.id || checkout.xendit_qr_id || ""),
            reference_id: String(
              (reusedCheckoutQr as { reference_id?: unknown }).reference_id ||
                checkout.xendit_external_id ||
                ""
            ),
            qr_string: String((reusedCheckoutQr as { qr_string?: unknown }).qr_string || ""),
            amount:
              Number(
                (reusedCheckoutQr as { amount?: unknown }).amount != null
                  ? (reusedCheckoutQr as { amount?: unknown }).amount
                  : amount
              ) || amount,
            expires_at: (reusedCheckoutQr as { expires_at?: unknown }).expires_at
              ? String((reusedCheckoutQr as { expires_at?: unknown }).expires_at)
              : null,
            checkout_id: checkoutId,
          },
        });
      }

      referenceId = `pos-chk-${checkoutId}`;
      const { error: reserveError } = await db
        .from("pos_checkouts")
        .update({
          xendit_external_id: referenceId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutId);
      if (reserveError) {
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS checkout" },
          { status: 500 }
        );
      }
    }

    if (amount == null || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Nominal tidak valid" },
        { status: 400 }
      );
    }

    const qr = await createXenditDynamicQr({
      secretKey: xendit.secretKey,
      referenceId,
      amount,
      callbackUrl: xendit.callbackUrl,
      description: `POS ${Math.round(amount)}`,
    });

    if (checkoutId) {
      const { error: saveError } = await db
        .from("pos_checkouts")
        .update({
          xendit_qr_id: qr.id,
          xendit_external_id: qr.reference_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutId);
      if (saveError) {
        console.error("[pos] save checkout qris ids:", saveError.message);
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS checkout" },
          { status: 500 }
        );
      }
    }

    if (orderId) {
      const { error: saveOrderError } = await db
        .from("pos_orders")
        .update({
          xendit_qr_id: qr.id,
          xendit_external_id: qr.reference_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      if (saveOrderError) {
        console.error("[pos] save order qris ids:", saveOrderError.message);
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS order" },
          { status: 500 }
        );
      }
    }

    const identity = await getSettings([
      SETTING_KEYS.QRIS_MERCHANT_NAME,
      SETTING_KEYS.QRIS_NMID,
      SETTING_KEYS.COMPANY_LEGAL_NAME,
    ]);

    return NextResponse.json({
      success: true,
      data: {
        qr_id: qr.id,
        reference_id: qr.reference_id,
        qr_string: qr.qr_string,
        amount: qr.amount,
        expires_at: qr.expires_at,
        ...(checkoutId ? { checkout_id: checkoutId } : {}),
        ...(orderId ? { order_id: orderId } : {}),
        merchant_name:
          identity[SETTING_KEYS.QRIS_MERCHANT_NAME] ||
          identity[SETTING_KEYS.COMPANY_LEGAL_NAME] ||
          null,
        nmid: identity[SETTING_KEYS.QRIS_NMID] || null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat QR pembayaran";
    console.error("[pos] create qris error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 }
    );
  }
}
