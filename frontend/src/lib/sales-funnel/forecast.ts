/**
 * EPIC-050 Fase 3 (T-3.2) — forecast & target, bagian murni.
 * Kategori forecast per deal mengikuti probability tahap (bisa dioverride di deal):
 *   closed_won / closed_lost (tahap menang/kalah), commit ≥ 75, best_case ≥ 50, pipeline < 50.
 * Weighted pipeline = Σ nilai × probability/100 untuk deal terbuka pada periode.
 */
import { z } from "zod";

export const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "closed_won", "closed_lost"] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export const FORECAST_CATEGORY_LABELS: Record<ForecastCategory, string> = {
  pipeline: "Pipeline",
  best_case: "Best case",
  commit: "Commit",
  closed_won: "Menang",
  closed_lost: "Kalah",
};

export function categoryFromStage(stage: { is_won: boolean; is_lost: boolean; probability: number }): ForecastCategory {
  if (stage.is_won) return "closed_won";
  if (stage.is_lost) return "closed_lost";
  if (stage.probability >= 75) return "commit";
  if (stage.probability >= 50) return "best_case";
  return "pipeline";
}

export const targetSchema = z.object({
  /** null = target perusahaan (seluruh tim) */
  user_id: z.string().uuid().nullable(),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "format YYYY-MM"),
  target_value: z.number().min(0).max(99_999_999_999),
  target_deals: z.number().int().min(0).max(10_000).optional().nullable(),
  pipeline_id: z.string().uuid().optional().nullable(),
});
export type TargetInput = z.infer<typeof targetSchema>;

/** YYYY-MM → [from, to) sebagai YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: next };
}

export interface ForecastDealRow {
  owner_user_id: string | null;
  owner_name: string | null;
  pipeline_id: string | null;
  value: number;            // value_final ?? value_estimate
  probability: number;      // dari tahap
  category: ForecastCategory;
}

export interface ForecastRow {
  user_id: string | null;
  user_name: string;
  target_value: number;
  target_deals: number | null;
  won_value: number;
  won_deals: number;
  commit_value: number;
  best_case_value: number;
  pipeline_value: number;
  weighted_value: number;
  open_deals: number;
  /** won + weighted vs target */
  attainment_percent: number;
  gap: number;
  /** Hanya di baris total: jumlah target salesperson (bila target perusahaan dipakai). */
  allocated_target_value?: number;
  /** Hanya di baris total: true bila target_value berasal dari target perusahaan. */
  company_target_set?: boolean;
}

export interface TargetSource {
  user_id: string | null;
  target_value: number;
  target_deals: number | null;
}

/** Pisahkan target perusahaan (user_id null) dari target salesperson. */
export function splitTargets(targets: TargetSource[]): { company: { target_value: number; target_deals: number | null } | null; users: Array<TargetSource & { user_id: string }> } {
  let company: { target_value: number; target_deals: number | null } | null = null;
  const users: Array<TargetSource & { user_id: string }> = [];
  for (const t of targets) {
    if (t.user_id === null) {
      company = company ?? { target_value: 0, target_deals: null };
      company.target_value += Number(t.target_value) || 0;
      if (t.target_deals != null) company.target_deals = (company.target_deals ?? 0) + t.target_deals;
    } else users.push({ ...t, user_id: t.user_id });
  }
  return { company, users };
}

/**
 * Agregasi per penanggung jawab: menang (closed_won) + kategori terbuka.
 * Deal tanpa owner masuk baris "Tanpa PJ" (user_id null).
 */
export function aggregateForecast(
  deals: ForecastDealRow[],
  targets: TargetSource[],
  users: Array<{ id: string; name: string }>
): ForecastRow[] {
  const { users: userTargets } = splitTargets(targets);
  const rows = new Map<string | null, ForecastRow>();
  const ensure = (userId: string | null, name: string) => {
    let r = rows.get(userId);
    if (!r) {
      r = {
        user_id: userId, user_name: name, target_value: 0, target_deals: null, won_value: 0, won_deals: 0,
        commit_value: 0, best_case_value: 0, pipeline_value: 0, weighted_value: 0, open_deals: 0, attainment_percent: 0, gap: 0,
      };
      rows.set(userId, r);
    }
    return r;
  };
  for (const u of users) ensure(u.id, u.name);
  for (const t of userTargets) {
    const r = ensure(t.user_id, users.find((u) => u.id === t.user_id)?.name ?? "—");
    r.target_value += Number(t.target_value) || 0;
    if (t.target_deals != null) r.target_deals = (r.target_deals ?? 0) + t.target_deals;
  }
  for (const d of deals) {
    const r = ensure(d.owner_user_id, d.owner_name ?? "Tanpa PJ");
    const v = Number(d.value) || 0;
    switch (d.category) {
      case "closed_won":
        r.won_value += v;
        r.won_deals += 1;
        break;
      case "closed_lost":
        break;
      default: {
        r.open_deals += 1;
        r.weighted_value += Math.round((v * (Number(d.probability) || 0)) / 100);
        if (d.category === "commit") r.commit_value += v;
        else if (d.category === "best_case") r.best_case_value += v;
        else r.pipeline_value += v;
      }
    }
  }
  for (const r of rows.values()) {
    const projected = r.won_value + r.weighted_value;
    r.attainment_percent = r.target_value > 0 ? Math.round((projected / r.target_value) * 1000) / 10 : 0;
    r.gap = Math.max(0, r.target_value - projected);
  }
  return Array.from(rows.values()).sort((a, b) => {
    if (a.user_id === null) return 1;
    if (b.user_id === null) return -1;
    return b.won_value + b.weighted_value - (a.won_value + a.weighted_value);
  });
}

/**
 * Baris total. Bila target perusahaan diisi, target total = target perusahaan
 * dan allocated_target_value = Σ target salesperson; jika tidak, total = Σ salesperson.
 */
export function sumForecast(rows: ForecastRow[], companyTarget?: { target_value: number; target_deals: number | null } | null): ForecastRow {
  const total: ForecastRow = {
    user_id: "total", user_name: "Total", target_value: 0, target_deals: null, won_value: 0, won_deals: 0,
    commit_value: 0, best_case_value: 0, pipeline_value: 0, weighted_value: 0, open_deals: 0, attainment_percent: 0, gap: 0,
  };
  for (const r of rows) {
    total.target_value += r.target_value;
    if (r.target_deals != null) total.target_deals = (total.target_deals ?? 0) + r.target_deals;
    total.won_value += r.won_value;
    total.won_deals += r.won_deals;
    total.commit_value += r.commit_value;
    total.best_case_value += r.best_case_value;
    total.pipeline_value += r.pipeline_value;
    total.weighted_value += r.weighted_value;
    total.open_deals += r.open_deals;
  }
  total.allocated_target_value = total.target_value;
  total.company_target_set = Boolean(companyTarget && companyTarget.target_value > 0);
  if (total.company_target_set && companyTarget) {
    total.target_value = Number(companyTarget.target_value) || 0;
    total.target_deals = companyTarget.target_deals;
  }
  const projected = total.won_value + total.weighted_value;
  total.attainment_percent = total.target_value > 0 ? Math.round((projected / total.target_value) * 1000) / 10 : 0;
  total.gap = Math.max(0, total.target_value - projected);
  return total;
}
