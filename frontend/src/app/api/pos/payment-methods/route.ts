import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getPosSession, requireIamAction, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  createPosPaymentMethod,
  deletePosPaymentMethod,
  listPosPaymentMethods,
  updatePosPaymentMethod,
} from "@/lib/pos/payment-methods-store";
import {
  isManualPaymentHandler,
  isValidPaymentMethodCode,
  slugifyPaymentMethodCode,
} from "@/lib/pos/payment-methods";

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const activeOnly =
      request.nextUrl.searchParams.get("active") === "1" ||
      request.nextUrl.searchParams.get("activeOnly") === "true";
    const data = await listPosPaymentMethods({ activeOnly });
    return successResponse(data);
  } catch (err) {
    console.error("[pos] list payment methods:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat metode bayar" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(200).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  new_code: z.string().trim().min(2).max(40).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    await requireIamAction(IAM.posOperations, "update");
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    throw err;
  }

  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { code, ...patch } = parsed.data;
    if (!isValidPaymentMethodCode(code) && !slugifyPaymentMethodCode(code)) {
      return NextResponse.json(
        { success: false, error: "Kode metode tidak dikenali" },
        { status: 400 }
      );
    }
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.is_active === undefined &&
      patch.sort_order === undefined &&
      patch.new_code === undefined
    ) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    const updated = await updatePosPaymentMethod(code, patch);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Metode bayar tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(updated, "Metode bayar diperbarui");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui metode bayar";
    const known =
      /tidak valid|tidak bisa diubah|sudah dipakai|metode bawaan/i.test(message);
    console.error("[pos] update payment method:", err);
    return NextResponse.json(
      { success: false, error: known ? message : "Gagal memperbarui metode bayar" },
      { status: known ? 400 : 500 }
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(40).optional(),
  description: z.string().trim().max(200).optional(),
  handler: z.enum(["cash", "credit"]),
});

export async function POST(request: NextRequest) {
  try {
    await requireIamAction(IAM.posOperations, "update");
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    if (!isManualPaymentHandler(parsed.data.handler)) {
      return NextResponse.json(
        { success: false, error: "Metode baru hanya Tunai atau Kartu" },
        { status: 400 }
      );
    }
    const created = await createPosPaymentMethod(parsed.data);
    return successResponse(created, "Metode bayar ditambahkan");
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    const message = err instanceof Error ? err.message : "Gagal menambah metode bayar";
    const status = /sudah dipakai/i.test(message) ? 409 : 400;
    console.error("[pos] create payment method:", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireIamAction(IAM.posOperations, "delete");
    const code = String(request.nextUrl.searchParams.get("code") || "").trim();
    if (!isValidPaymentMethodCode(code)) {
      return NextResponse.json(
        { success: false, error: "Kode metode tidak valid" },
        { status: 400 }
      );
    }
    const deleted = await deletePosPaymentMethod(code);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Metode bayar tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ code }, "Metode bayar dihapus");
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    const message = err instanceof Error ? err.message : "Gagal menghapus metode bayar";
    console.error("[pos] delete payment method:", err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
