import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import {
  CONTRACT_SORT_COLUMNS,
  parseContractListParams,
} from "@/lib/hris/contracts-list";

/**
 * GET /api/hris/contracts — daftar kontrak karyawan lintas karyawan
 * (halaman HRIS → Kontrak). Filter: status, tipe, cari nama/nomor,
 * days=N (hanya yang berakhir ≤ N hari, termasuk yang sudah lewat).
 * Sort whitelist di lib/hris/contracts-list.
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const params = parseContractListParams(req.nextUrl.searchParams);

    const where: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      values.push(params.status);
      where.push(`c.status = $${values.length}`);
    }
    if (params.contractType) {
      values.push(params.contractType);
      where.push(`c.contract_type = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      where.push(
        `(e.full_name ILIKE $${values.length} OR c.contract_number ILIKE $${values.length})`
      );
    }
    if (params.expiringWithin !== null) {
      values.push(params.expiringWithin);
      where.push(`c.end_date IS NOT NULL AND c.end_date <= current_date + $${values.length}::int`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = `ORDER BY ${CONTRACT_SORT_COLUMNS[params.sortBy]} ${params.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST, c.created_at DESC`;

    const countRow = await queryOne<{ count: string }>(
      `SELECT count(*) FROM hris.employment_contracts c
       JOIN hris.employees e ON e.id = c.employee_id
       ${whereSql}`,
      values
    );
    const total = Number(countRow?.count ?? 0);

    values.push(params.limit, (params.page - 1) * params.limit);
    const rows = await query(
      `SELECT c.id, c.employee_id, e.full_name AS employee_name,
              c.contract_number, c.contract_type, c.status,
              c.start_date, c.end_date, c.probation_end_date,
              (c.end_date - current_date)::int AS days_left,
              c.position_title, c.department_name, c.base_salary, c.sequence
       FROM hris.employment_contracts c
       JOIN hris.employees e ON e.id = c.employee_id
       ${whereSql}
       ${orderSql}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return NextResponse.json({
      data: rows,
      total,
      page: params.page,
      limit: params.limit,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts] LIST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
