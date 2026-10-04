import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import { hasAnyIamMenuPrefix } from "@/lib/iam/match";
import {
  DESKTOP_OVERVIEW_ROLES,
  buildDesktopOverview,
  type DesktopOverview,
} from "@/lib/desktop/overview";
import { PERIOD_KINDS, type PeriodKind } from "@/lib/desktop/period";

/**
 * GET /api/desktop/overview — data papan monitoring desktop (EPIC-019).
 *
 * Digate role super_admin + direksi (padanan "owner" — role itu belum ada di
 * iam). Cache in-memory 60 detik: interval refresh klien juga 60 detik, jadi
 * beberapa tab/user berbagi satu kali kerja query alih-alih menumbuk DB
 * bersamaan. Cache per-proses PM2 — cukup, karena datanya ringkasan monitoring,
 * bukan transaksi.
 */

const CACHE_TTL_MS = 60_000;
// Cache DI-KUNCI per periode (EPIC-037 Fase A). Satu slot bersama akan membuat
// pengguna yang memilih MTD menerima angka YTD milik pengguna lain selama 60
// detik — kesalahan yang tidak terlihat karena angkanya tetap "masuk akal".
const cached = new Map<PeriodKind, { at: number; data: DesktopOverview }>();

function parsePeriod(value: string | null): PeriodKind {
  return (PERIOD_KINDS as readonly string[]).includes(value ?? "")
    ? (value as PeriodKind)
    : "today";
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const granted = await loadGrantedMenuCodesForUser(user.id, user.role);
    const allowed =
      hasAnyIamMenuPrefix(granted, IAM.dashboard) ||
      (granted.length === 0 &&
        (DESKTOP_OVERVIEW_ROLES as readonly string[]).includes(user.role));
    if (!allowed) throw ApiError.forbidden("Insufficient permissions");

    const periode = parsePeriod(request.nextUrl.searchParams.get("periode"));

    const hit = cached.get(periode);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: hit.data, cached: true });
    }

    const data = await buildDesktopOverview(periode);
    // Hasil dengan seksi gagal tidak di-cache: biarkan percobaan berikutnya
    // mencoba lagi, daripada mengunci kartu error selama 60 detik.
    if (data.gagal.length === 0) {
      cached.set(periode, { at: Date.now(), data });
    }

    return NextResponse.json({ data, cached: false });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop:overview] gagal:", error);
    return NextResponse.json({ error: "Gagal memuat ringkasan" }, { status: 500 });
  }
}
