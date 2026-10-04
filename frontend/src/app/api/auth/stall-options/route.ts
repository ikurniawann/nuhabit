import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { getStallAccess } from "@/lib/auth/stall-access";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";

/**
 * Daftar stall yang boleh dipilih user di switcher / kasir gate.
 * all_access=false → "Semua Stall" tidak tersedia; pilihan terbatas penempatan.
 *
 * Semua user login boleh membaca stall AKTIF-nya (dipakai struk POS untuk
 * mencetak asal stall); daftar pilihan hanya dikirim bila user memang boleh
 * pindah (can_switch) — POST /api/auth/active-stall tetap penjaga izinnya.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const scope = await getApiUserScope();
    const access = await getStallAccess(user.id, user.role, scope?.branchId ?? null);
    const canSwitch =
      user.role === "super_admin" ||
      user.role === "admin" ||
      access.allAccess ||
      access.stalls.length > 1;

    // Stall aktif ikut dikirim supaya tombol switcher di kasir bisa
    // menandai posisi sekarang tanpa endpoint tambahan. Cookie kosong =
    // mengikuti penempatan (stall pertama), "all" = Semua Stall.
    const resolved = await resolveActiveStallFromCookies();
    // Fallback cookie unset: user akses penuh = "Semua Stall" (selaras
    // resolvePosSellScope); user biasa mengikuti penempatan pertamanya.
    const active =
      resolved.mode === "stall"
        ? { id: resolved.stall.id, name: resolved.stall.name, code: resolved.stall.code }
        : resolved.mode === "all" || access.allAccess
          ? null
          : access.stalls[0]
            ? { id: access.stalls[0].id, name: access.stalls[0].name, code: access.stalls[0].code }
            : null;

    return NextResponse.json({
      success: true,
      data: {
        all_access: access.allAccess,
        can_switch: canSwitch,
        active,
        stalls: canSwitch
          ? access.stalls.map(({ id, name, code }) => ({ id, name, code }))
          : [],
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to load stall options";
    console.error("[api/auth/stall-options] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
