import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Karyawan HRIS aktif untuk ditautkan ke profil coach (fix salary tetap di payroll). */
export async function GET() {
  return studioRoute("coach employee-options GET", async () => {
    const ctx = await requireStudioContext();
    const rows = await query(
      `SELECT e.id, e.full_name, e.nip, e.phone, e.email,
              EXISTS (SELECT 1 FROM studio.coaches c WHERE c.employee_id = e.id AND c.branch_id = $1) AS linked
       FROM hris.employees e
       WHERE e.is_active
       ORDER BY e.full_name
       LIMIT 500`,
      [ctx.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}
