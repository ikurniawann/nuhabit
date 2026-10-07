import "server-only";
/** EPIC-050 T-4.2 — dashboard CRM: daftar, buat, susun widget report, hapus. */
import { z } from "zod";
import { ApiError, type ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne, withTransaction } from "@/lib/db";
import { scopedCompanyId } from "./guards";
import type { ReportDataset } from "./report-builder";
import {
  canManageShared,
  loadAccessibleReport,
  parseStoredDefinition,
  runReportDefinition,
} from "./report-builder-server";

interface DashboardRow { id: string; company_id: string | null; name: string; description: string | null; is_default: boolean; created_by: string | null }
interface WidgetRow {
  id: string; report_id: string; title: string | null; widget_type: string; width: number; sort_order: number;
  report_name: string; dataset: ReportDataset; definition: unknown;
}

export const createDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().default(false),
});

const widgetSchema = z.object({
  report_id: z.string().uuid(),
  title: z.string().trim().max(120).optional().nullable(),
  widget_type: z.enum(["chart", "kpi", "table"]).default("chart"),
  width: z.number().int().min(1).max(3).default(1),
});

export const patchDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().optional(),
  widgets: z.array(widgetSchema).max(24).optional(),
});

const NIL_UUID = "'00000000-0000-0000-0000-000000000000'::uuid";
/** Satu dashboard default (Overview) per company; NULL company = global. */
const SAME_COMPANY = `COALESCE(company_id, ${NIL_UUID}) = COALESCE($1::uuid, ${NIL_UUID})`;

export function listDashboards(scope: UserScope | null) {
  const params: unknown[] = [];
  let where = "d.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (d.company_id IS NULL OR d.company_id = $${params.length})`;
  }
  return query(
    `SELECT d.id, d.company_id, d.name, d.description, d.is_default, d.created_by, d.created_at, d.updated_at,
            u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
     FROM crm.crm_dashboards d
     LEFT JOIN configuration.users u ON u.id = d.created_by
     WHERE ${where}
     ORDER BY d.is_default DESC, d.name`,
    params
  );
}

export async function createDashboard(user: ApiUser, scope: UserScope | null, b: z.infer<typeof createDashboardSchema>) {
  const companyId = scopedCompanyId(user, scope);
  const makeDefault = b.is_default && canManageShared(user);
  if (makeDefault) {
    await query(
      `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
       WHERE is_default AND deleted_at IS NULL AND ${SAME_COMPANY}`,
      [companyId]
    );
  }
  return queryOne(
    `INSERT INTO crm.crm_dashboards (company_id, name, description, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, is_default`,
    [companyId, b.name, b.description ?? null, makeDefault, user.id]
  );
}

/** Dashboard di scope company user; 404 bila tidak ada. */
export async function requireDashboard(id: string, scope: UserScope | null): Promise<DashboardRow> {
  const params: unknown[] = [id];
  let where = "id = $1 AND deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  const row = await queryOne<DashboardRow>(
    `SELECT id, company_id, name, description, is_default, created_by FROM crm.crm_dashboards WHERE ${where}`,
    params
  );
  if (!row) throw ApiError.notFound("Dashboard tidak ditemukan");
  return row;
}

/** Widget dashboard beserta hasil tiap report. */
export async function loadDashboardWidgets(id: string, user: ApiUser, scope: UserScope | null) {
  const widgets = await query<WidgetRow>(
    `SELECT w.id, w.report_id, w.title, w.widget_type, w.width, w.sort_order,
            r.name AS report_name, r.dataset, r.definition
     FROM crm.crm_dashboard_widgets w
     JOIN crm.crm_reports r ON r.id = w.report_id AND r.deleted_at IS NULL
     WHERE w.dashboard_id = $1
     ORDER BY w.sort_order, w.id`,
    [id]
  );
  const results = await Promise.all(
    widgets.map(async (w) => {
      // Report yang tidak boleh dilihat user ini tampil kosong, bukan menggagalkan dashboard.
      const allowed = await loadAccessibleReport(w.report_id, user, scope);
      if (!allowed) return null;
      const definition = parseStoredDefinition(w.dataset, w.definition);
      try {
        return { definition, result: await runReportDefinition(definition, user, scope) };
      } catch {
        return null;
      }
    })
  );
  return widgets.map((w, i) => ({
    id: w.id, report_id: w.report_id, title: w.title ?? w.report_name, widget_type: w.widget_type,
    width: w.width, sort_order: w.sort_order, report_name: w.report_name, dataset: w.dataset,
    definition: results[i]?.definition ?? null,
    result: results[i]?.result ?? null,
  }));
}

export async function updateDashboard(
  dashboard: DashboardRow,
  user: ApiUser,
  scope: UserScope | null,
  b: z.infer<typeof patchDashboardSchema>
): Promise<void> {
  if (b.is_default !== undefined && !canManageShared(user)) {
    throw ApiError.forbidden("Hanya admin yang bisa menetapkan dashboard Overview");
  }
  for (const w of b.widgets ?? []) {
    if (!(await loadAccessibleReport(w.report_id, user, scope))) {
      throw ApiError.badRequest("Ada report yang tidak bisa diakses");
    }
  }
  const id = dashboard.id;
  await withTransaction(async (client) => {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (col: string, v: unknown) => { values.push(v); sets.push(`${col} = $${values.length}`); };
    if (b.name !== undefined) push("name", b.name);
    if (b.description !== undefined) push("description", b.description ?? null);
    if (b.is_default === true) {
      await client.query(
        `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
         WHERE is_default AND deleted_at IS NULL AND id <> $2 AND ${SAME_COMPANY}`,
        [dashboard.company_id, id]
      );
      push("is_default", true);
    } else if (b.is_default === false) push("is_default", false);
    if (values.length > 0) {
      values.push(id);
      await client.query(`UPDATE crm.crm_dashboards SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (b.widgets) {
      await client.query(`DELETE FROM crm.crm_dashboard_widgets WHERE dashboard_id = $1`, [id]);
      let order = 0;
      for (const w of b.widgets) {
        await client.query(
          `INSERT INTO crm.crm_dashboard_widgets (dashboard_id, report_id, title, widget_type, width, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, w.report_id, w.title ?? null, w.widget_type, w.width, order++]
        );
      }
    }
  });
}

export async function deleteDashboard(dashboard: DashboardRow, user: ApiUser): Promise<void> {
  if (dashboard.created_by !== user.id && !canManageShared(user)) {
    throw ApiError.forbidden("Hanya pembuat atau admin yang bisa menghapus dashboard ini");
  }
  await query(`UPDATE crm.crm_dashboards SET deleted_at = now(), is_default = false WHERE id = $1`, [dashboard.id]);
}
