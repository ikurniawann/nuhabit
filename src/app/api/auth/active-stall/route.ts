import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiUser, validateBody } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import {
  ACTIVE_STALL_ALL,
  ACTIVE_STALL_COOKIE,
  LEGACY_ACTIVE_STALL_COOKIE,
  findActiveStall,
} from "@/lib/auth/active-stall";
import { getStallAccess } from "@/lib/auth/stall-access";
import { isSecureRequest } from "@/lib/auth/secure-cookie";
import { queryOne } from "@/lib/db";

/** Simpan pilihan di cookie baru dan buang cookie nama lama. */
function writeActiveStallCookie(response: NextResponse, value: string, request: NextRequest) {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(request),
    path: "/",
  };
  response.cookies.set(ACTIVE_STALL_COOKIE, value, { ...options, maxAge: 60 * 60 * 24 * 30 });
  response.cookies.set(LEGACY_ACTIVE_STALL_COOKIE, "", { ...options, maxAge: 0 });
  return response;
}

const bodySchema = z.object({
  /** null = kembali ke "Semua Stall" */
  warehouse_id: z.string().uuid().nullable(),
});

/** Set stall aktif (switcher sidebar) — user dengan akses multi-stall / admin. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const { warehouse_id } = await validateBody(request, bodySchema);

    const scope = await getApiUserScope();
    const access = await getStallAccess(user.id, user.role, scope?.branchId ?? null);
    const canSwitch =
      user.role === "super_admin" ||
      user.role === "admin" ||
      access.allAccess ||
      access.stalls.length > 1;
    if (!canSwitch) {
      throw ApiError.forbidden("Akun ini tidak perlu mengganti stall");
    }

    if (warehouse_id === null) {
      // "Semua Stall" hanya untuk user tanpa pembatasan penempatan.
      if (!access.allAccess) {
        throw ApiError.forbidden("Anda hanya dapat memilih stall penempatan Anda");
      }
      // Simpan "all" agar berbeda dari cookie kosong (fallback ke penempatan).
      return writeActiveStallCookie(
        NextResponse.json({ success: true, data: { stall: null } }),
        ACTIVE_STALL_ALL,
        request
      );
    }

    if (!access.allAccess && !access.stalls.some((stall) => stall.id === warehouse_id)) {
      throw ApiError.forbidden("Stall di luar penempatan Anda");
    }

    const stall = await findActiveStall(warehouse_id);
    if (!stall) throw ApiError.notFound("Stall not found or inactive");

    // Stall harus berada di branch user login (jika user punya branch).
    if (scope?.branchId) {
      const warehouse = await queryOne<{ branch_id: string }>(
        `SELECT branch_id FROM configuration.warehouses WHERE id = $1`,
        [stall.id]
      );
      if (warehouse && warehouse.branch_id !== scope.branchId) {
        throw ApiError.forbidden("Stall berada di luar branch Anda");
      }
    }

    return writeActiveStallCookie(
      NextResponse.json({ success: true, data: { stall } }),
      stall.id,
      request
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to set active stall";
    console.error("[api/auth/active-stall] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
