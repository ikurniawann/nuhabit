import { NextRequest } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const paramsSchema = z.object({
  actor_id: z.string().uuid().optional(),
  entity: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  entity_id: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
  date_from: z.string().regex(DATE).optional(),
  date_to: z.string().regex(DATE).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
};

/** GET /api/audit — jejak audit, terbaru dulu. Filter aktor, entitas, aksi, tanggal. */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsAudit);
    const raw = Object.fromEntries(
      [...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== "" && value !== "all")
    );
    const params = paramsSchema.parse(raw);

    const values: unknown[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const where: string[] = [];
    if (params.actor_id) where.push(`a.actor_id = ${add(params.actor_id)}`);
    if (params.entity) where.push(`a.entity = ${add(params.entity)}`);
    if (params.action) where.push(`a.action = ${add(params.action)}`);
    if (params.entity_id) where.push(`a.entity_id = ${add(params.entity_id)}`);
    if (params.search?.trim()) {
      const term = add(`%${params.search.trim()}%`);
      where.push(`(a.entity_label ILIKE ${term} OR a.reason ILIKE ${term} OR a.actor_name ILIKE ${term})`);
    }
    // Rentang tanggal dalam zona Asia/Jakarta (timezone sesi pool).
    if (params.date_from) where.push(`a.created_at >= ${add(params.date_from)}::date`);
    if (params.date_to) where.push(`a.created_at < (${add(params.date_to)}::date + 1)`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM audit.audit_log a ${whereSql}`,
      values
    );
    const limit = add(params.limit);
    const offset = add((params.page - 1) * params.limit);
    const rows = await query<AuditRow>(
      `SELECT a.id, a.created_at::text AS created_at, a.actor_id,
              COALESCE(a.actor_name, u.full_name) AS actor_name,
              a.action, a.entity, a.entity_id, a.entity_label, a.before, a.after, a.reason, a.ip
         FROM audit.audit_log a
         LEFT JOIN configuration.users u ON u.id = a.actor_id
         ${whereSql}
        ORDER BY a.created_at DESC, a.id
        LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    const actors = await query<{ actor_id: string; actor_name: string | null }>(
      `SELECT DISTINCT ON (actor_id) actor_id, actor_name
         FROM audit.audit_log WHERE actor_id IS NOT NULL
        ORDER BY actor_id, created_at DESC
        LIMIT 200`
    );

    const count = Number(total?.total ?? 0);
    return Response.json({
      success: true,
      data: rows,
      actors,
      meta: { page: params.page, limit: params.limit, total: count, totalPages: Math.ceil(count / params.limit) },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return Response.json({ success: false, message: "Filter tidak valid" }, { status: 400 });
    }
    console.error("GET /api/audit", error);
    return Response.json({ success: false, message: "Gagal memuat jejak audit" }, { status: 500 });
  }
}
