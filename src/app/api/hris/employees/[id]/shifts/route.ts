import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne, withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { isDirectSubordinate } from "@/lib/hris/team";

/**
 * Permintaan owner 2026-08-29: bukan hanya HRD — supervisor/kepala divisi
 * (atasan langsung menurut employees.reporting_to) boleh melihat & mengatur
 * jadwal shift anggota timnya sendiri. Helper ini meloloskan HR via menu
 * IAM seperti sebelumnya, ATAU atasan langsung karyawan target.
 */
async function authorizeShiftManager(
  targetEmployeeId: string
): Promise<{ actorName: string } | NextResponse> {
  try {
    const user = await requireIamMenuPrefix([...IAM.hrisKepegawaian, ...IAM.hrisWorkforce]);
    return { actorName: user.full_name };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const actor = await getWorkforceActor();
  if (!actor?.employeeId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isDirectSubordinate(actor.employeeId, targetEmployeeId))) {
    return NextResponse.json(
      { error: "Hanya HRD atau atasan langsung yang boleh mengatur jadwal karyawan ini" },
      { status: 403 }
    );
  }
  const me = await queryOne<{ full_name: string }>(
    `SELECT full_name FROM hris.employees WHERE id = $1`,
    [actor.employeeId]
  );
  return { actorName: me?.full_name || "Atasan" };
}

/**
 * GET /api/hris/employees/[id]/shifts — pola jadwal shift karyawan yang
 *     berlaku saat ini (7 hari) + riwayat singkat.
 * PUT /api/hris/employees/[id]/shifts — set pola mingguan baru berlaku
 *     sejak effective_from: pola lama ditutup (effective_to), pola dengan
 *     tanggal mulai ≥ effective_from digantikan. Transaksional.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }
    const auth = await authorizeShiftManager(id);
    if (auth instanceof NextResponse) return auth;

    const rows = await query(
      `SELECT es.id, es.day_of_week, es.shift_id, es.effective_from, es.effective_to,
              s.name AS shift_name, s.start_time, s.end_time
       FROM hris.employee_shifts es
       LEFT JOIN hris.shifts s ON s.id = es.shift_id
       WHERE es.employee_id = $1
       ORDER BY es.effective_from DESC, es.day_of_week ASC`,
      [id]
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[employee-shifts] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PutBody {
  effective_from?: string;
  days?: { day_of_week?: number; shift_id?: string | null }[];
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }
    const auth = await authorizeShiftManager(id);
    if (auth instanceof NextResponse) return auth;

    const body = (await req.json()) as PutBody;
    if (!body.effective_from || !DATE_RE.test(body.effective_from)) {
      return NextResponse.json(
        { error: "Tanggal mulai berlaku wajib diisi (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const days = body.days ?? [];
    const daySet = new Set(days.map((d) => d.day_of_week));
    if (days.length !== 7 || daySet.size !== 7 || [...daySet].some((d) => !d || d < 1 || d > 7)) {
      return NextResponse.json(
        { error: "Pola jadwal harus lengkap 7 hari (Senin–Minggu)" },
        { status: 400 }
      );
    }
    for (const day of days) {
      if (day.shift_id !== null && day.shift_id !== undefined && !UUID_RE.test(day.shift_id)) {
        return NextResponse.json({ error: "ID shift tidak valid" }, { status: 400 });
      }
    }

    const effectiveFrom = body.effective_from;
    await withTransaction(async (client) => {
      // pola yang mulai pada/setelah tanggal baru digantikan seluruhnya
      await client.query(
        `DELETE FROM hris.employee_shifts
         WHERE employee_id = $1 AND effective_from >= $2`,
        [id, effectiveFrom]
      );
      // pola berjalan ditutup sehari sebelum pola baru berlaku
      await client.query(
        `UPDATE hris.employee_shifts
         SET effective_to = ($2::date - 1)
         WHERE employee_id = $1 AND effective_from < $2
           AND (effective_to IS NULL OR effective_to >= $2)`,
        [id, effectiveFrom]
      );
      for (const day of days) {
        await client.query(
          `INSERT INTO hris.employee_shifts
             (employee_id, day_of_week, shift_id, effective_from, created_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, day.day_of_week, day.shift_id ?? null, effectiveFrom, auth.actorName]
        );
      }
    });

    return NextResponse.json({
      message: `Jadwal shift disimpan — berlaku mulai ${effectiveFrom}`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[employee-shifts] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
