import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import {
  getPoPayableContext,
  normalizeTermDescription,
  resolvePoPaymentParty,
} from "@/lib/purchasing/po-payments";
import type { poPaymentTermSchema } from "@/lib/purchasing/po-schemas";

const AMOUNT_TOLERANCE = 0.01;

/** Nilai tagihan yang belum dijadwalkan ke termin aktif (minimal 0). */
export function remainingSchedulable(
  payableAmount: number,
  termAmounts: Array<number | string | null>
): number {
  const scheduled = termAmounts.reduce<number>((sum, amount) => sum + Number(amount || 0), 0);
  return Math.max(0, payableAmount - scheduled);
}

export async function listPoPaymentTerms(db: DbClient, poId: string) {
  const [{ data: terms, error: termsError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      db
        .from("purchase_order_payment_terms")
        .select("*")
        .eq("purchase_order_id", poId)
        .eq("is_active", true)
        .order("term_no", { ascending: true }),
      db
        .from("vendor_payments")
        .select("*")
        .eq("purchase_order_id", poId)
        .neq("status", "void")
        .order("payment_date", { ascending: false }),
    ]);
  if (termsError) throw termsError;
  if (paymentsError) throw paymentsError;
  return { terms: terms ?? [], payments: payments ?? [] };
}

export async function createPoPaymentTerm(
  db: DbClient,
  poId: string,
  input: z.infer<typeof poPaymentTermSchema>
) {
  const ctx = await getPoPayableContext(db, poId);
  if (!ctx) throw ApiError.notFound("Purchase order not found");

  const party = resolvePoPaymentParty(ctx);
  const payableAmount = ctx.payableAmount ?? 0;

  const { data: existingTerms, error: existingTermsError } = await db
    .from("purchase_order_payment_terms")
    .select("amount")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);
  if (existingTermsError) throw existingTermsError;

  const schedulable = remainingSchedulable(
    payableAmount,
    ((existingTerms ?? []) as Array<{ amount: number | string | null }>).map((term) => term.amount)
  );
  if (input.amount > schedulable + AMOUNT_TOLERANCE) {
    throw ApiError.badRequest(
      `Payment term amount cannot exceed remaining schedulable amount (${schedulable})`
    );
  }

  const { data: latestTerm, error: latestError } = await db
    .from("purchase_order_payment_terms")
    .select("term_no")
    .eq("purchase_order_id", poId)
    .eq("is_active", true)
    .order("term_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  const termNo = input.term_no || Number(latestTerm?.term_no || 0) + 1;
  const { data, error } = await db
    .from("purchase_order_payment_terms")
    .insert({
      purchase_order_id: poId,
      supplier_id: party.supplier_id,
      vendor_id: party.vendor_id,
      term_no: termNo,
      description: normalizeTermDescription(input.description, input.amount, payableAmount, termNo),
      due_date: input.due_date,
      amount: input.amount,
      notes: input.notes || null,
      status: input.amount <= 0 ? "paid" : "unpaid",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Termin tanpa pembayaran dinonaktifkan (status cancelled). */
export async function cancelPoPaymentTerm(db: DbClient, poId: string, termId: string) {
  const { data: term, error: termError } = await db
    .from("purchase_order_payment_terms")
    .select("id, purchase_order_id, paid_amount, status, is_active")
    .eq("id", termId)
    .eq("purchase_order_id", poId)
    .single();
  if (termError || !term) throw ApiError.notFound("Termin pembayaran tidak ditemukan");
  if (!term.is_active) throw ApiError.badRequest("Termin pembayaran sudah tidak aktif");
  if (Number(term.paid_amount || 0) > 0 || ["partial", "paid"].includes(term.status)) {
    throw ApiError.badRequest("Termin yang sudah memiliki pembayaran tidak bisa dihapus");
  }

  const { count, error: paymentError } = await db
    .from("vendor_payments")
    .select("id", { count: "exact", head: true })
    .eq("payment_term_id", termId)
    .neq("status", "void");
  if (paymentError) throw paymentError;
  if ((count || 0) > 0) {
    throw ApiError.badRequest("Termin yang sudah memiliki riwayat pembayaran tidak bisa dihapus");
  }

  const { error } = await db
    .from("purchase_order_payment_terms")
    .update({ is_active: false, status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", termId)
    .eq("purchase_order_id", poId);
  if (error) throw error;
}
