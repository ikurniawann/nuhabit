import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { hashPosPin, isValidPosPin } from "@/lib/pos/supervisor-pin";

/**
 * Kelola supervisor POS + PIN void/merge (UI baru, owner 2026-08-16).
 *
 * Sebelumnya PIN hanya bisa diisi manual ke DB (users.pos_pin, plaintext).
 * Lewat endpoint ini PIN selalu disimpan sebagai hash bcrypt; PIN plaintext
 * lama tetap diterima oleh void/merge (lihat lib/pos/supervisor-pin) sampai
 * di-reset dari sini.
 */

/** Role yang TIDAK boleh diubah dari halaman ini — akun berkuasa. */
const PROTECTED_ROLES = new Set(["super_admin", "admin"]);

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.posSupervisors);
    const db = createPgClient();

    // ?candidates=1&search=... → daftar user non-supervisor utk picker "Tambah"
    if (request.nextUrl.searchParams.get("candidates") === "1") {
      const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
      let query = db
        .from("users")
        .select("id, full_name, email, role")
        .neq("role", "pos_supervisor")
        .order("full_name", { ascending: true })
        .limit(20);
      if (search) {
        query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      const { data: candidates, error: candErr } = await query;
      if (candErr) throw candErr;
      return NextResponse.json({
        success: true,
        data: {
          candidates: (candidates ?? []).filter(
            (row: { role: string }) => !PROTECTED_ROLES.has(row.role)
          ),
        },
      });
    }

    const { data: supervisors, error } = await db
      .from("users")
      .select("id, full_name, email, pos_pin")
      .eq("role", "pos_supervisor")
      .order("full_name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: {
        supervisors: (supervisors ?? []).map(
          (row: { id: string; full_name: string | null; email: string | null; pos_pin: string | null }) => ({
            id: row.id,
            full_name: row.full_name,
            email: row.email,
            has_pin: Boolean(row.pos_pin),
            // PIN legacy plaintext perlu di-reset supaya ter-hash
            legacy_pin: Boolean(row.pos_pin && !row.pos_pin.startsWith("$2")),
          })
        ),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[pos/supervisors] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar supervisor" },
      { status: 500 }
    );
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_pin"),
    user_id: z.string().uuid(),
    pin: z.string(),
  }),
  z.object({
    action: z.literal("promote"),
    user_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("demote"),
    user_id: z.string().uuid(),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.posSupervisors);
    const body = bodySchema.parse(await request.json());
    const db = createPgClient();

    const { data: target, error: targetErr } = await db
      .from("users")
      .select("id, full_name, role")
      .eq("id", body.user_id)
      .single();
    if (targetErr || !target) {
      return NextResponse.json(
        { success: false, error: "User tidak ditemukan" },
        { status: 404 }
      );
    }

    if (body.action === "set_pin") {
      if (!isValidPosPin(body.pin)) {
        return NextResponse.json(
          { success: false, error: "PIN harus 4-6 digit angka" },
          { status: 400 }
        );
      }
      if (target.role !== "pos_supervisor") {
        return NextResponse.json(
          { success: false, error: "User ini bukan supervisor POS" },
          { status: 400 }
        );
      }
      const { error } = await db
        .from("users")
        .update({ pos_pin: await hashPosPin(body.pin), updated_at: new Date().toISOString() })
        .eq("id", body.user_id);
      if (error) throw error;
      return NextResponse.json({ success: true, data: { message: "PIN tersimpan" } });
    }

    if (body.action === "promote") {
      if (PROTECTED_ROLES.has(target.role)) {
        return NextResponse.json(
          { success: false, error: "Akun admin tidak bisa dijadikan supervisor POS — role penuhnya akan hilang" },
          { status: 400 }
        );
      }
      if (target.role === "pos_supervisor") {
        return NextResponse.json(
          { success: false, error: "User sudah menjadi supervisor POS" },
          { status: 400 }
        );
      }
      const { error } = await db
        .from("users")
        .update({ role: "pos_supervisor", updated_at: new Date().toISOString() })
        .eq("id", body.user_id);
      if (error) throw error;
      return NextResponse.json({
        success: true,
        data: { message: "User dijadikan supervisor POS — set PIN-nya sekarang" },
      });
    }

    // demote — kembali jadi kasir; PIN ikut dihapus supaya tidak jadi zombie
    if (target.role !== "pos_supervisor") {
      return NextResponse.json(
        { success: false, error: "User ini bukan supervisor POS" },
        { status: 400 }
      );
    }
    const { error } = await db
      .from("users")
      .update({ role: "pos", pos_pin: null, updated_at: new Date().toISOString() })
      .eq("id", body.user_id);
    if (error) throw error;
    return NextResponse.json({
      success: true,
      data: { message: "Akses supervisor dicabut (role kembali kasir POS)" },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Payload tidak valid" },
        { status: 400 }
      );
    }
    console.error("[pos/supervisors] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan perubahan supervisor" },
      { status: 500 }
    );
  }
}
