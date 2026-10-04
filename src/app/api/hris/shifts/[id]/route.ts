import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";

/**
 * PATCH  /api/hris/shifts/[id] — perbarui master shift
 * DELETE /api/hris/shifts/[id] — hapus bila belum pernah dipakai;
 *        bila sudah dirujuk jadwal/absensi, dinonaktifkan (is_active=false)
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID shift tidak valid" }, { status: 400 });
    }
    const body = (await req.json()) as {
      name?: string;
      start_time?: string;
      end_time?: string;
      break_minutes?: number;
      late_tolerance_minutes?: number;
      is_overnight?: boolean;
      is_active?: boolean;
      sort_order?: number;
    };

    if (body.start_time !== undefined && !TIME_RE.test(body.start_time)) {
      return NextResponse.json({ error: "Jam mulai tidak valid" }, { status: 400 });
    }
    if (body.end_time !== undefined && !TIME_RE.test(body.end_time)) {
      return NextResponse.json({ error: "Jam selesai tidak valid" }, { status: 400 });
    }

    const updated = await queryOne(
      `UPDATE hris.shifts SET
         name                   = COALESCE($2, name),
         start_time             = COALESCE($3::time, start_time),
         end_time               = COALESCE($4::time, end_time),
         break_minutes          = COALESCE($5, break_minutes),
         late_tolerance_minutes = COALESCE($6, late_tolerance_minutes),
         is_overnight           = COALESCE($7, is_overnight),
         is_active              = COALESCE($8, is_active),
         sort_order             = COALESCE($9, sort_order)
       WHERE id = $1 RETURNING id, name`,
      [
        id,
        body.name?.trim() ?? null,
        body.start_time ?? null,
        body.end_time ?? null,
        body.break_minutes ?? null,
        body.late_tolerance_minutes ?? null,
        body.is_overnight ?? null,
        body.is_active ?? null,
        body.sort_order ?? null,
      ]
    );
    if (!updated) {
      return NextResponse.json({ error: "Shift tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json({ message: "Shift diperbarui" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[shifts] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID shift tidak valid" }, { status: 400 });
    }

    const used = await queryOne<{ used: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM hris.employee_shifts WHERE shift_id = $1
         UNION ALL
         SELECT 1 FROM hris.attendance WHERE shift_id = $1
       ) AS used`,
      [id]
    );
    if (used?.used) {
      await queryOne(
        `UPDATE hris.shifts SET is_active = false WHERE id = $1 RETURNING id`,
        [id]
      );
      return NextResponse.json({
        message: "Shift sudah dipakai jadwal/absensi — dinonaktifkan (tidak dihapus)",
      });
    }

    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM hris.shifts WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!deleted) {
      return NextResponse.json({ error: "Shift tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json({ message: "Shift dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[shifts] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
