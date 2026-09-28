import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { awardCrmXpForTopup } from "@/lib/crm/loyalty-engine";
import { verifySupervisorPinServer, type ApprovedSupervisor } from "@/lib/pos/supervisor-pin-server";
import { notifyFocTopup } from "@/lib/wa/comp-notification";
import { resolveTopupVenue } from "@/lib/pos/topup-venue";
import {
  calculateTopupXp,
  idrToArk,
  loadPosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";
import {
  buildQrImageUrl,
  createXenditDynamicQr,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function resolvePaymentMethod(raw: unknown): "cash" | "qris" | "credit" | "foc" {
  const value = String(raw || "qris").toLowerCase();
  if (value === "cash") return "cash";
  if (value === "foc") return "foc";
  if (value === "credit" || value === "credit_card") return "credit";
  return "qris";
}

function resolveWebhookCallbackUrl(request: NextRequest, configured: string | null) {
  if (configured) return configured;
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin;
  return `${origin}/api/payments/xendit/webhook`;
}

// GET /api/pos/topup — riwayat wallet member (topup / bayar / refund / bonus).
// Tanpa customer_id: fallback topup-only (kompatibel pemanggil lama).
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get("customer_id");
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10) || 50));

    let query = db
      .from("pos_wallet_transactions")
      .select(`
        *,
        customer:pos_customers(name, phone)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (customerId) {
      query = query.eq("customer_id", customerId);
    } else {
      query = query.eq("type", "topup");
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const orderIds = Array.from(
      new Set(
        rows
          .map((row) => (row.order_id != null ? String(row.order_id) : ""))
          .filter(Boolean)
      )
    );

    const orderNumberById = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: orders, error: orderError } = await db
        .from("pos_orders")
        .select("id, order_number")
        .in("id", orderIds);
      if (orderError) throw orderError;
      for (const order of (orders ?? []) as Array<{ id: string; order_number?: string | null }>) {
        if (order.order_number) orderNumberById.set(String(order.id), String(order.order_number));
      }
    }

    const enriched = rows.map((row) => ({
      ...row,
      order_number:
        row.order_id != null ? orderNumberById.get(String(row.order_id)) ?? null : null,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: unknown) {
    console.error("Error fetching topup history:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/pos/topup - Process Ark Coin topup (cash immediate; QRIS via Xendit)
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const body = await request.json();
    // Topup = mengisi saldo ARK Coin; seluruh endpoint tertutup bila fitur mati.
    const arkBlocked = await rejectIfArkCoinDisabled(true);
    if (arkBlocked) return arkBlocked;
    const {
      customer_id,
      amount,
      payment_method: rawMethod = "qris",
      xendit_transaction_id,
      supervisor_pin,
    } = body;

    const payment_method = resolvePaymentMethod(rawMethod);

    // FOC (owner 2026-09-01): saldo diberikan GRATIS utk marketing — wajib
    // PIN supervisor, tidak menghasilkan XP, dan owner dikabari via WA.
    let focApprover: ApprovedSupervisor | null = null;
    if (payment_method === "foc") {
      const pin = String(supervisor_pin || "").trim();
      if (!pin) {
        return NextResponse.json(
          { success: false, error: "Topup FOC membutuhkan PIN supervisor" },
          { status: 400 }
        );
      }
      focApprover = await verifySupervisorPinServer(pin);
      if (!focApprover) {
        return NextResponse.json(
          { success: false, error: "PIN supervisor tidak valid" },
          { status: 403 }
        );
      }
    }

    if (!customer_id || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Customer ID and valid amount are required" },
        { status: 400 }
      );
    }

    const loyaltySettings = await loadPosLoyaltySettings(db);
    const amountValue = Number(amount) || 0;
    // Venue topup (owner 2026-09-04): cabang kasir yang login, fallback venue
    // default CRM — supaya tidak ada lagi topup "tanpa venue" di rekonsiliasi.
    const venue = await resolveTopupVenue(db, sessionUserId);

    if (amountValue < loyaltySettings.topup_min_amount) {
      return NextResponse.json(
        {
          success: false,
          error: `Minimum top-up is Rp ${loyaltySettings.topup_min_amount.toLocaleString("id-ID")}`,
        },
        { status: 400 }
      );
    }

    const arkCoins = idrToArk(amountValue, loyaltySettings.ark_rate);

    const { data: customer, error: customerError } = await db
      .from("pos_customers")
      .select("ark_coin_balance, total_spent")
      .eq("id", customer_id)
      .single();

    if (customerError || !customer) {
      return NextResponse.json({ success: false, error: "Customer not found" }, { status: 404 });
    }

    const balanceBefore = Number(customer.ark_coin_balance) || 0;

    // ── Cash / credit / FOC: credit wallet immediately ─────────────────────
    if (payment_method === "cash" || payment_method === "credit" || payment_method === "foc") {
      const balanceAfter = balanceBefore + amountValue;

      // Topup tidak menambah total_spent (CRM: dasar top spender = belanja order saja).
      const { error: updateError } = await db
        .from("pos_customers")
        .update({
          ark_coin_balance: balanceAfter,
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer_id);

      if (updateError) throw updateError;

      const { data: transaction, error: transactionError } = await db
        .from("pos_wallet_transactions")
        .insert({
          customer_id,
          type: "topup",
          company_id: venue.companyId,
          branch_id: venue.branchId,
          amount: amountValue,
          ark_coins: arkCoins,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          payment_method,
          status: "completed",
          xendit_transaction_id: xendit_transaction_id || null,
          notes:
            payment_method === "foc"
              ? `FOC top-up (marketing) — disetujui ${focApprover?.name ?? "supervisor"}`
              : payment_method === "cash"
                ? "Cash top-up"
                : "Card top-up",
          metadata:
            payment_method === "foc"
              ? {
                  settled_via: "foc",
                  approved_by_id: focApprover?.id ?? null,
                  approved_by_name: focApprover?.name ?? null,
                  xp_awarded: false,
                }
              : { settled_via: "cashier" },
        })
        .select()
        .single();

      if (transactionError) throw transactionError;

      // FOC: tanpa XP (XP adalah imbalan uang tunai), kabari owner.
      const xpPreview = payment_method === "foc" ? 0 : calculateTopupXp(amountValue, loyaltySettings);
      const crmXp =
        payment_method === "foc"
          ? { status: "skipped" as const, xpAwarded: 0, reason: "foc_topup" }
          : transaction?.id
            ? await awardCrmXpForTopup(db, {
                customerId: customer_id,
                topupAmountIdr: amountValue,
                transactionId: String(transaction.id),
              })
            : { status: "skipped" as const, xpAwarded: 0, reason: "missing_transaction" };
      if (payment_method === "foc" && transaction?.id) {
        void notifyFocTopup({
          transactionId: String(transaction.id),
          amountIdr: amountValue,
          approvedName: focApprover?.name ?? null,
          customerId: customer_id,
        });
      }

      return NextResponse.json(
        {
          success: true,
          data: {
            status: "completed",
            transaction,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            ark_coins: arkCoins,
            ark_rate: loyaltySettings.ark_rate,
            xp_awarded: crmXp.xpAwarded || xpPreview,
            crm_xp: crmXp,
            qr_code_url: null,
          },
        },
        { status: 201 }
      );
    }

    // ── QRIS: create dynamic QR, keep wallet pending until paid ─────────────
    if (amountValue < 1500) {
      return NextResponse.json(
        { success: false, error: "Minimum QRIS top-up is Rp 1.500" },
        { status: 400 }
      );
    }

    const xendit = await loadActiveXenditConfig(db);
    const referenceId = `topup_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const callbackUrl = resolveWebhookCallbackUrl(request, xendit.callbackUrl);

    const qr = await createXenditDynamicQr({
      secretKey: xendit.secretKey,
      referenceId,
      amount: amountValue,
      callbackUrl,
      description: `ARK topup ${amountValue}`,
    });

    const { data: transaction, error: transactionError } = await db
      .from("pos_wallet_transactions")
      .insert({
        customer_id,
        type: "topup",
        company_id: venue.companyId,
        branch_id: venue.branchId,
        amount: amountValue,
        ark_coins: arkCoins,
        balance_before: balanceBefore,
        balance_after: balanceBefore,
        payment_method: "qris",
        status: "pending",
        xendit_transaction_id: qr.id,
        reference_id: referenceId,
        notes: "Waiting for QRIS payment",
        metadata: {
          provider: "xendit",
          environment: xendit.environment,
          qr_string: qr.qr_string,
          expires_at: qr.expires_at,
          xendit_status: qr.status,
        },
      })
      .select()
      .single();

    if (transactionError) throw transactionError;

    return NextResponse.json(
      {
        success: true,
        data: {
          status: "pending",
          transaction,
          topup_id: transaction.id,
          balance_before: balanceBefore,
          balance_after: balanceBefore,
          ark_coins: arkCoins,
          ark_rate: loyaltySettings.ark_rate,
          xp_awarded: 0,
          qr_code_url: buildQrImageUrl(qr.qr_string),
          qr_string: qr.qr_string,
          xendit_qr_id: qr.id,
          reference_id: referenceId,
          expires_at: qr.expires_at,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error processing topup:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
