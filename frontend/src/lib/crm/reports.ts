import { toNumber } from "@/lib/crm/server";

export type ReportPeriod = {
  /** Batas bawah inklusif (ISO). */
  fromIso: string;
  /** Batas atas EKSKLUSIF (ISO) — query pakai `created_at < to`. */
  toIso: string;
  /** Label untuk ditampilkan/di-echo balik ke client (YYYY-MM-DD). */
  fromDate: string;
  toDate: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PERIOD_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Periode laporan dari query string. Default: awal bulan berjalan s/d hari
 * ini. `to` inklusif di sisi user (tanggal), jadi batas query = to + 1 hari
 * (eksklusif). Tanggal tidak valid / kebalik / rentang > 366 hari → null.
 */
export function resolveReportPeriod(
  fromParam: string | null | undefined,
  toParam: string | null | undefined,
  now: Date = new Date()
): ReportPeriod | null {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  let from = defaultFrom;
  let to = todayUtc;

  if (fromParam) {
    if (!DATE_PATTERN.test(fromParam)) return null;
    const parsed = new Date(`${fromParam}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    from = parsed;
  }

  if (toParam) {
    if (!DATE_PATTERN.test(toParam)) return null;
    const parsed = new Date(`${toParam}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    to = parsed;
  }

  if (from.getTime() > to.getTime()) return null;
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) return null;

  const toExclusive = new Date(to.getTime() + DAY_MS);

  return {
    fromIso: from.toISOString(),
    toIso: toExclusive.toISOString(),
    fromDate: toDateOnly(from),
    toDate: toDateOnly(to),
  };
}

export type TopSpenderRow = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  total_spend: number;
  ark_spend: number;
  last_order_at: string | null;
};

export type FrequentVisitorRow = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  visit_days: number;
  lifetime_visits: number;
  last_visit_at: string | null;
};

export type VenueReconciliationRow = {
  company_id: string | null;
  branch_id: string | null;
  company_name: string;
  branch_name: string;
  /** Topup BERBAYAR (cash/QRIS) — kas yang benar-benar masuk. */
  topup_amount: number;
  bonus_amount: number;
  /** Topup FOC (gratis, marketing) — liabilitas tanpa kas masuk. */
  foc_topup_amount: number;
  spend_amount: number;
  other_amount: number;
  topup_count: number;
  foc_topup_count: number;
  payment_count: number;
  /** (topup + bonus + foc) - spend: >0 = venue masih memegang liabilitas ARK. */
  net_flow: number;
};

type RawRecord = Record<string, unknown>;

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** timestamptz arrives from node-postgres as a Date; the JSON body carries its ISO form. */
function asTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value) || null;
}

export function mapTopSpenderRow(row: RawRecord): TopSpenderRow {
  return {
    id: asText(row.id),
    name: asText(row.name, "Customer"),
    phone: asText(row.phone),
    membership_tier: asText(row.membership_tier, "regular"),
    member_type: asText(row.member_type, "registered"),
    order_count: toNumber(row.order_count),
    total_spend: toNumber(row.total_spend),
    ark_spend: toNumber(row.ark_spend),
    last_order_at: asTimestamp(row.last_order_at),
  };
}

export function mapFrequentVisitorRow(row: RawRecord): FrequentVisitorRow {
  return {
    id: asText(row.id),
    name: asText(row.name, "Customer"),
    phone: asText(row.phone),
    membership_tier: asText(row.membership_tier, "regular"),
    member_type: asText(row.member_type, "registered"),
    order_count: toNumber(row.order_count),
    visit_days: toNumber(row.visit_days),
    lifetime_visits: toNumber(row.lifetime_visits),
    last_visit_at: asTimestamp(row.last_visit_at),
  };
}

export function mapVenueReconciliationRow(row: RawRecord): VenueReconciliationRow {
  const topup = toNumber(row.topup_amount);
  const bonus = toNumber(row.bonus_amount);
  const foc = toNumber(row.foc_topup_amount);
  const spend = toNumber(row.spend_amount);
  return {
    company_id: asText(row.company_id, "") || null,
    branch_id: asText(row.branch_id, "") || null,
    company_name: asText(row.company_name, "Tanpa venue"),
    branch_name: asText(row.branch_name, "-"),
    topup_amount: topup,
    bonus_amount: bonus,
    foc_topup_amount: foc,
    spend_amount: spend,
    other_amount: toNumber(row.other_amount),
    topup_count: toNumber(row.topup_count),
    foc_topup_count: toNumber(row.foc_topup_count),
    payment_count: toNumber(row.payment_count),
    net_flow: topup + bonus + foc - spend,
  };
}

export type ReconciliationTotals = {
  topup_amount: number;
  bonus_amount: number;
  foc_topup_amount: number;
  spend_amount: number;
  net_flow: number;
};

export function sumReconciliation(rows: VenueReconciliationRow[]): ReconciliationTotals {
  return rows.reduce<ReconciliationTotals>(
    (acc, row) => ({
      topup_amount: acc.topup_amount + row.topup_amount,
      bonus_amount: acc.bonus_amount + row.bonus_amount,
      foc_topup_amount: acc.foc_topup_amount + row.foc_topup_amount,
      spend_amount: acc.spend_amount + row.spend_amount,
      net_flow: acc.net_flow + row.net_flow,
    }),
    { topup_amount: 0, bonus_amount: 0, foc_topup_amount: 0, spend_amount: 0, net_flow: 0 }
  );
}
