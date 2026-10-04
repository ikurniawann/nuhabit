import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  aggregateForecast,
  monthRange,
  splitTargets,
  sumForecast,
  targetSchema,
  type ForecastDealRow,
} from "./forecast";
import type { SalesFunnelUser } from "./server";
import { isUuid } from "./sql";

/** `?month=YYYY-MM`, default bulan berjalan (UTC, pola lama). */
export function parseMonthParam(raw: string | null): string {
  const month = raw ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw ApiError.badRequest("month: YYYY-MM");
  return month;
}

/**
 * EPIC-050 T-3.2 — forecast bulanan. Periode deal: menang → closed_at di
 * bulan tsb; terbuka → event_date di bulan tsb, fallback bulan dibuat bila
 * event_date kosong. Weighted = Σ nilai × probability tahap.
 */
export async function loadForecast(
  user: SalesFunnelUser,
  scope: UserScope | null,
  month: string,
  pipelineIdRaw: string | null
) {
  const companyId = scope?.companyId ?? null;
  const pipelineId = isUuid(pipelineIdRaw) ? pipelineIdRaw : null;
  const isSales = user.role === "sales";
  const { from, to } = monthRange(month);

  const params: unknown[] = [from, to, companyId];
  let extra = "";
  if (pipelineId) {
    params.push(pipelineId);
    extra += ` AND d.pipeline_id = $${params.length}`;
  }
  if (isSales) {
    params.push(user.id);
    extra += ` AND (d.owner_user_id = $${params.length} OR d.owner_user_id IS NULL)`;
  }
  const deals = await query<
    ForecastDealRow & { deal_id: string; title: string; org_name: string; stage_name: string; event_date: string | null }
  >(
    `SELECT d.id AS deal_id, d.title, l.org_name, d.owner_user_id, u.full_name AS owner_name, d.pipeline_id,
            COALESCE(d.value_final, d.value_estimate, 0)::numeric AS value,
            s.probability, s.name AS stage_name, d.event_date::text AS event_date,
            CASE WHEN s.is_won THEN 'closed_won' WHEN s.is_lost THEN 'closed_lost' ELSE d.forecast_category END AS category
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     WHERE d.deleted_at IS NULL
       AND ($3::uuid IS NULL OR d.company_id = $3)
       AND (
         (s.is_won AND d.closed_at >= $1::date AND d.closed_at < $2::date)
         OR (NOT s.is_won AND NOT s.is_lost AND COALESCE(d.event_date, d.created_at::date) >= $1::date AND COALESCE(d.event_date, d.created_at::date) < $2::date)
       )${extra}
     ORDER BY d.event_date NULLS LAST`,
    params
  );
  const targets = await query<{ user_id: string | null; target_value: number; target_deals: number | null }>(
    `SELECT user_id, target_value, target_deals FROM crm.crm_sales_targets
     WHERE period_month = $1::date AND ($2::uuid IS NULL OR company_id = $2)
       AND ($3::uuid IS NULL OR pipeline_id IS NULL OR pipeline_id = $3)`,
    [from, companyId, pipelineId]
  );
  const users = await query<{ id: string; name: string }>(
    `SELECT id, full_name AS name FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin') AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)
       ${isSales ? "AND id = $2" : ""}
     ORDER BY full_name`,
    isSales ? [companyId, user.id] : [companyId]
  );

  const normalizedTargets = targets.map((t) => ({ ...t, target_value: Number(t.target_value) }));
  const { company: companyTarget } = splitTargets(normalizedTargets);
  const rows = aggregateForecast(
    deals.map((d) => ({ ...d, value: Number(d.value) })),
    normalizedTargets,
    users
  );
  return {
    month,
    rows,
    company_target: companyTarget,
    total: sumForecast(rows, companyTarget),
    deals: deals.map((d) => ({
      id: d.deal_id,
      title: d.title,
      org_name: d.org_name,
      owner_user_id: d.owner_user_id,
      owner_name: d.owner_name,
      value: Number(d.value),
      probability: d.probability,
      category: d.category,
      stage_name: d.stage_name,
      event_date: d.event_date,
      pipeline_id: d.pipeline_id,
    })),
  };
}

/** Target per salesperson + target perusahaan (user_id null); sales hanya melihat miliknya + perusahaan. */
export async function listTargets(user: SalesFunnelUser, companyId: string | null, month: string) {
  const { from } = monthRange(month);
  const isSales = user.role === "sales";
  return query(
    `SELECT t.id, t.user_id, u.full_name, t.period_month::text AS period_month, t.target_value, t.target_deals, t.pipeline_id
     FROM crm.crm_sales_targets t LEFT JOIN configuration.users u ON u.id = t.user_id
     WHERE t.period_month = $1::date AND ($2::uuid IS NULL OR t.company_id = $2)
       ${isSales ? "AND (t.user_id = $3 OR t.user_id IS NULL)" : ""}
     ORDER BY t.user_id IS NOT NULL, u.full_name`,
    isSales ? [from, companyId, user.id] : [from, companyId]
  );
}

export const saveTargetsSchema = z.object({ targets: z.array(targetSchema).min(1).max(200) });

export async function saveTargets(
  targets: z.infer<typeof saveTargetsSchema>["targets"],
  companyId: string,
  userId: string
): Promise<number> {
  for (const t of targets) {
    const { from } = monthRange(t.period_month);
    await query(
      `INSERT INTO crm.crm_sales_targets (company_id, user_id, period_month, target_value, target_deals, pipeline_id, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (company_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_month, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET target_value = EXCLUDED.target_value, target_deals = EXCLUDED.target_deals, updated_at = now()`,
      [companyId, t.user_id, from, t.target_value, t.target_deals ?? null, t.pipeline_id ?? null, userId]
    );
  }
  return targets.length;
}
