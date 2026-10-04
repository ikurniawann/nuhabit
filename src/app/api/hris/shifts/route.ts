import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";

/**
 * GET  /api/hris/shifts — master shift kerja (dipakai halaman Shift Kerja
 *      dan tab Jadwal Shift karyawan)
 * POST /api/hris/shifts — buat shift baru
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export interface ShiftRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  late_tolerance_minutes: number;
  is_overnight: boolean;
  is_active: boolean;
  sort_order: number;
}

export async function GET() {
  try {
    // Master shift boleh DIBACA semua karyawan ber-akun — dipakai dropdown
    // pengaturan jadwal tim oleh atasan (2026-08-29). Tulis tetap HR-only.
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rows = await query<ShiftRow>(
      `SELECT id, name, start_time, end_time, break_minutes,
              late_tolerance_minutes, is_overnight, is_active, sort_order
       FROM hris.shifts
       ORDER BY sort_order ASC, name ASC`
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[shifts] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface ShiftBody {
  name?: string;
  start_time?: string;
  end_time?: string;
  break_minutes?: number;
  late_tolerance_minutes?: number;
  is_overnight?: boolean;
  sort_order?: number;
}

function validateShiftBody(body: ShiftBody): string | null {
  if (!body.name?.trim()) return "Nama shift wajib diisi";
  if (!body.start_time || !TIME_RE.test(body.start_time)) return "Jam mulai tidak valid (HH:MM)";
  if (!body.end_time || !TIME_RE.test(body.end_time)) return "Jam selesai tidak valid (HH:MM)";
  if (
    body.late_tolerance_minutes !== undefined &&
    (!Number.isInteger(body.late_tolerance_minutes) || body.late_tolerance_minutes < 0)
  ) {
    return "Toleransi terlambat harus angka ≥ 0";
  }
  if (!body.is_overnight && body.end_time <= body.start_time) {
    return "Jam selesai harus setelah jam mulai — atau tandai sebagai shift malam (lewat tengah malam)";
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const body = (await req.json()) as ShiftBody;

    const invalid = validateShiftBody(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const created = await queryOne<ShiftRow>(
      `INSERT INTO hris.shifts
         (name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, start_time, end_time, break_minutes,
                 late_tolerance_minutes, is_overnight, is_active, sort_order`,
      [
        body.name!.trim(),
        body.start_time,
        body.end_time,
        body.break_minutes ?? 60,
        body.late_tolerance_minutes ?? 10,
        body.is_overnight ?? false,
        body.sort_order ?? 0,
      ]
    );
    return NextResponse.json(
      { data: created, message: `Shift "${created?.name}" dibuat` },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[shifts] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
