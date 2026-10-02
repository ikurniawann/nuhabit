import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  createXenditDynamicQr,
  getXenditQrCode,
  getXenditQrPayments,
  isXenditQrPaid,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { issuePass, venueToday } from "@/lib/studio/pass-server";
import type { BookingActor } from "@/lib/studio/booking-server";

/**
 * Beli paket online dari Member App (EPIC-057 T-057-5). Pass baru diterbitkan
 * hanya saat pembayaran lunas — via webhook Xendit atau cek status dari aplikasi.
 */

/** Prefix reference_id Xendit → dikenali webhook sebagai pesanan paket. */
export const PASS_ORDER_PREFIX = "NHP-";
const ORDER_TTL_MINUTES = 30;
const VA_TTL_HOURS = 24;

export type PaymentMethodCode = "qris" | "va" | "card";
export const VA_BANKS = ["BCA", "BNI", "BRI", "MANDIRI", "PERMATA"] as const;
export type VaBank = (typeof VA_BANKS)[number];
/** Prefix nomor VA tiruan per bank (simulator DEV). */
const VA_PREFIX: Record<VaBank, string> = { BCA: "39358", BNI: "8808", BRI: "26215", MANDIRI: "88908", PERMATA: "8215" };
/** Kartu uji simulator — Member App tidak pernah meminta/menyimpan nomor kartu sungguhan. */
const SIM_CARD_LAST4 = "1111";

/**
 * Simulator pembayaran DEV (PAYMENT_SIMULATOR=1): QRIS, VA, dan kartu tampil
 * seperti sungguhan dan diperlakukan sukses lewat tombol simulasi. Jangan
 * disetel di produksi.
 */
export function isPaymentSimulator(): boolean {
  return process.env.PAYMENT_SIMULATOR === "1";
}

export interface PaymentOptions {
  methods: PaymentMethodCode[];
  banks: VaBank[];
  simulator: boolean;
}

/** Metode yang ditawarkan: simulator → semua; produksi → QRIS bila Xendit aktif (VA & kartu menyusul). */
export async function paymentOptions(): Promise<PaymentOptions> {
  if (isPaymentSimulator()) return { methods: ["qris", "va", "card"], banks: [...VA_BANKS], simulator: true };
  const xendit = await loadActiveXenditConfig().then(() => true).catch(() => false);
  return { methods: xendit ? ["qris"] : [], banks: [], simulator: false };
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  category: string;
  class_credits: number;
  pt_credits: number;
  facility_access: boolean;
  validity_days: number;
  price: number;
}

export interface PassOrderView {
  id: string;
  order_code: string;
  product_name: string;
  amount: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  payment_method: PaymentMethodCode;
  qr_string: string | null;
  va_bank: string | null;
  va_number: string | null;
  card_last4: string | null;
  simulated: boolean;
  expires_at: string;
  paid_at: string | null;
  pass_code: string | null;
}

export async function loadShopProducts(branchId: string): Promise<ShopProduct[]> {
  return query<ShopProduct>(
    `SELECT id, name, description, category, class_credits, pt_credits, facility_access, validity_days, price::float8 AS price
     FROM studio.pass_products
     WHERE branch_id = $1 AND is_active AND sell_online AND price > 0
     ORDER BY sort_order, price`,
    [branchId]
  );
}

const ORDER_SELECT = `o.id, o.order_code, o.product_name, o.amount::float8 AS amount, o.status, o.payment_method, o.qr_string,
  o.va_bank, o.va_number, o.card_last4, (o.gateway = 'simulator') AS simulated, o.expires_at, o.paid_at, mp.pass_code`;

async function loadOrder(where: string, params: unknown[]) {
  return queryOne<PassOrderView & { customer_id: string; company_id: string; branch_id: string; product_id: string; gateway_qr_id: string | null }>(
    `SELECT ${ORDER_SELECT}, o.customer_id, o.company_id, o.branch_id, o.product_id, o.gateway_qr_id
     FROM studio.pass_orders o LEFT JOIN studio.member_passes mp ON mp.id = o.pass_id
     WHERE ${where}`,
    params
  );
}

function view(o: PassOrderView): PassOrderView {
  const pending = o.status === "pending";
  return {
    id: o.id, order_code: o.order_code, product_name: o.product_name, amount: o.amount, status: o.status,
    payment_method: o.payment_method, qr_string: pending ? o.qr_string : null, va_bank: o.va_bank,
    va_number: pending ? o.va_number : null, card_last4: o.card_last4, simulated: o.simulated,
    expires_at: o.expires_at, paid_at: o.paid_at, pass_code: o.pass_code,
  };
}

function orderCode(): string {
  const d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(2, 10).replace(/-/g, "");
  return `${PASS_ORDER_PREFIX}${d}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function simVaNumber(bank: VaBank): string {
  const digits = Array.from(randomBytes(16), (b) => String(b % 10)).join("");
  return (VA_PREFIX[bank] + digits).slice(0, 16);
}

/** QRIS tiruan (format EMV, bisa dirender jadi QR) untuk simulator. */
function simQrString(code: string, amount: number): string {
  return `00020101021226580016ID.NUHABIT.DEV0118${code}5204799953033605405${Math.round(amount)}5802ID5907NUHABIT6007JAKARTA6304SIMU`;
}

/** Buat pesanan + instruksi bayar. Pesanan pending yang masih berlaku untuk paket & metode sama dipakai ulang. */
export async function createPassOrder(
  actor: BookingActor,
  customerId: string,
  productId: string,
  method: PaymentMethodCode = "qris",
  bank: VaBank | null = null
): Promise<PassOrderView> {
  const product = await queryOne<{ id: string; name: string; price: number }>(
    `SELECT id, name, price::float8 AS price FROM studio.pass_products
     WHERE id = $1 AND branch_id = $2 AND is_active AND sell_online AND price > 0`,
    [productId, actor.branchId]
  );
  if (!product) throw ApiError.notFound("This pass isn't available to buy online");
  const options = await paymentOptions();
  if (!options.methods.includes(method)) {
    throw ApiError.conflict(
      options.methods.length ? "This payment method isn't available yet. Please choose another one." : "Online payment isn't available yet. Please buy your pass at the front desk."
    );
  }
  if (method === "va" && !bank) throw ApiError.badRequest("Please choose a bank for the virtual account");

  const existing = await loadOrder(
    `o.customer_id = $1 AND o.product_id = $2 AND o.status = 'pending' AND o.payment_method = $3
       AND COALESCE(o.va_bank, '') = COALESCE($4, '') AND o.expires_at > now() + interval '2 minutes'`,
    [customerId, productId, method, method === "va" ? bank : null]
  );
  if (existing) return view(existing);

  const code = orderCode();
  const insert = async (f: { gateway: string; qrId?: string | null; qr?: string | null; va?: string | null; last4?: string | null; expiresAt: string }) => {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO studio.pass_orders (company_id, branch_id, order_code, customer_id, product_id, product_name, amount, gateway,
         payment_method, gateway_qr_id, qr_string, va_bank, va_number, card_last4, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        actor.companyId, actor.branchId, code, customerId, product.id, product.name, product.price, f.gateway,
        method, f.qrId ?? null, f.qr ?? null, method === "va" ? bank : null, f.va ?? null, f.last4 ?? null, f.expiresAt,
      ]
    );
    return view((await loadOrder("o.id = $1", [row!.id]))!);
  };

  if (options.simulator) {
    const ttl = method === "va" ? VA_TTL_HOURS * 3600_000 : ORDER_TTL_MINUTES * 60_000;
    return insert({
      gateway: "simulator",
      qr: method === "qris" ? simQrString(code, product.price) : null,
      va: method === "va" && bank ? simVaNumber(bank) : null,
      last4: method === "card" ? SIM_CARD_LAST4 : null,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    });
  }

  // Produksi: QRIS via Xendit (VA & kartu belum ditawarkan — lihat paymentOptions).
  const config = await loadActiveXenditConfig();
  const qr = await createXenditDynamicQr({
    secretKey: config.secretKey,
    referenceId: code,
    amount: product.price,
    callbackUrl: config.callbackUrl,
    description: `Paket ${product.name}`,
  }).catch((e) => {
    console.error("[studio] buat QR pesanan paket gagal:", e);
    throw ApiError.conflict("We couldn't create the QRIS. Please try again shortly.");
  });
  const expiresAt = qr.expires_at && Date.parse(qr.expires_at) > Date.now() ? qr.expires_at : new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString();
  return insert({ gateway: "xendit", qrId: qr.id, qr: qr.qr_string, expiresAt });
}

const METHOD_LABEL: Record<string, string> = { qris: "QRIS", va: "Virtual Account", card: "Kartu kredit" };

/** Simulator DEV: tandai pesanan lunas (QRIS terbayar / transfer VA masuk / kartu disetujui). */
export async function simulatePayment(orderId: string, customerId: string): Promise<PassOrderView> {
  if (!isPaymentSimulator()) throw ApiError.notFound("Not available");
  const order = await loadOrder("o.id = $1 AND o.customer_id = $2", [orderId, customerId]);
  if (!order) throw ApiError.notFound("Order not found");
  if (!order.simulated) throw ApiError.conflict("This order uses a real payment gateway");
  if (order.status === "pending" && Date.parse(order.expires_at) < Date.now()) {
    await query(`UPDATE studio.pass_orders SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'pending'`, [order.id]);
    throw ApiError.conflict("Payment time is up. Please start a new payment.");
  }
  if (order.status === "pending") {
    await settlePassOrder(order.id, `SIM-${order.payment_method.toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`);
  }
  return view((await loadOrder("o.id = $1", [order.id]))!);
}

/**
 * Lunasi pesanan → terbitkan pass (idempoten). Klaim status lebih dulu supaya
 * webhook dan cek status yang datang bersamaan tidak menerbitkan dua pass.
 * Pembayaran yang masuk setelah QR kedaluwarsa tetap dihormati (uang sudah diterima).
 */
export async function settlePassOrder(orderId: string, paymentRef: string | null): Promise<void> {
  const claimed = await queryOne<{ id: string; company_id: string; branch_id: string; customer_id: string; product_id: string; amount: number; order_code: string; payment_method: string; va_bank: string | null; gateway: string }>(
    `UPDATE studio.pass_orders SET status = 'paid', paid_at = now(), gateway_payment_ref = $2, updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'expired')
     RETURNING id, company_id, branch_id, customer_id, product_id, amount::float8 AS amount, order_code, payment_method, va_bank, gateway`,
    [orderId, paymentRef]
  );
  if (!claimed) return;
  try {
    const pass = await issuePass(
      { companyId: claimed.company_id, branchId: claimed.branch_id, user: { id: null } },
      {
        customer_id: claimed.customer_id,
        product_id: claimed.product_id,
        valid_from: await venueToday(),
        payment_method: "xendit",
        payment_ref: paymentRef ?? claimed.order_code,
        price_override: claimed.amount,
        channel: "online",
        notes: `Pembelian Member App ${claimed.order_code} · ${METHOD_LABEL[claimed.payment_method] ?? claimed.payment_method}${claimed.va_bank ? ` ${claimed.va_bank}` : ""}${claimed.gateway === "simulator" ? " (simulasi DEV)" : ""}`,
      }
    );
    await query(`UPDATE studio.pass_orders SET pass_id = $2, updated_at = now() WHERE id = $1`, [orderId, pass.id]);
  } catch (e) {
    // Gagal terbit (mis. paket dinonaktifkan) → kembalikan ke pending supaya bisa diulang / ditangani staf.
    await query(`UPDATE studio.pass_orders SET status = 'pending', paid_at = NULL, updated_at = now() WHERE id = $1`, [orderId]);
    throw e;
  }
}

/** Webhook Xendit: cari pesanan dari reference_id / QR id. true bila pesanan paket. */
export async function settlePassOrderFromWebhook(input: { referenceId: string; qrId: string; paymentId: string }): Promise<boolean> {
  const byRef = input.referenceId.startsWith(PASS_ORDER_PREFIX);
  const order = byRef
    ? await queryOne<{ id: string }>(`SELECT id FROM studio.pass_orders WHERE order_code = $1`, [input.referenceId])
    : input.qrId
      ? await queryOne<{ id: string }>(`SELECT id FROM studio.pass_orders WHERE gateway_qr_id = $1`, [input.qrId])
      : null;
  if (!order) return byRef;
  await settlePassOrder(order.id, input.paymentId || input.qrId || null);
  return true;
}

/** Status pesanan untuk Member App; cek ke Xendit bila masih pending. */
export async function refreshPassOrder(orderId: string, customerId: string): Promise<PassOrderView> {
  const order = await loadOrder("o.id = $1 AND o.customer_id = $2", [orderId, customerId]);
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status !== "pending") return view(order);

  if (order.gateway_qr_id && !order.simulated) {
    try {
      const config = await loadActiveXenditConfig();
      const qr = await getXenditQrCode(config.secretKey, order.gateway_qr_id);
      let paid = isXenditQrPaid(qr);
      let ref: string | null = null;
      if (!paid) {
        const payments = await getXenditQrPayments(config.secretKey, order.gateway_qr_id).catch(() => []);
        const ok = payments.find((p) => ["SUCCEEDED", "SUCCESS", "COMPLETED", "PAID"].includes(String(p.status ?? "").toUpperCase()));
        if (ok) {
          paid = true;
          ref = ok.id ? String(ok.id) : null;
        }
      }
      if (paid) await settlePassOrder(order.id, ref ?? order.gateway_qr_id);
    } catch (e) {
      console.warn("[studio] cek status pesanan paket gagal:", e instanceof Error ? e.message : e);
    }
  }
  await query(`UPDATE studio.pass_orders SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'pending' AND expires_at < now()`, [order.id]);
  return view((await loadOrder("o.id = $1", [order.id]))!);
}

export async function loadMemberOrders(customerId: string): Promise<PassOrderView[]> {
  const rows = await query<PassOrderView>(
    `SELECT ${ORDER_SELECT} FROM studio.pass_orders o LEFT JOIN studio.member_passes mp ON mp.id = o.pass_id
     WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 10`,
    [customerId]
  );
  return rows.map(view);
}
