/**
 * EPIC-050 Fase 2 (T-2.2) — lead scoring berbasis aturan (logika murni).
 *
 * Dua jenis aturan (crm.crm_scoring_rules):
 *   • field — cocokkan field lead (source, org_type, temperature, …) dengan operator
 *   • event — hitung kejadian (task_done per jenis, wa_inbound, deal_created,
 *             quotation_sent) dalam window_days, dibatasi max_count
 * Skor = Σ poin aturan yang cocok; tidak dibatasi 0..100 tapi UI menandai
 * "Hot" ≥ 70, "Warm" ≥ 40. Sinyal email menyusul Fase 7 (keputusan owner).
 */
import { z } from "zod";

export const SCORING_FIELDS = [
  "source",
  "org_type",
  "temperature",
  "status",
  "city",
  "pic_email",
  "pic_title",
  "account_type",
  "industry",
] as const;
export type ScoringField = (typeof SCORING_FIELDS)[number];

export const SCORING_OPERATORS = ["eq", "neq", "in", "contains", "not_empty", "gt", "lt"] as const;
export type ScoringOperator = (typeof SCORING_OPERATORS)[number];

export const SCORING_EVENT_TYPES = ["task_done", "wa_inbound", "deal_created", "quotation_sent"] as const;
export type ScoringEventType = (typeof SCORING_EVENT_TYPES)[number];

export const scoringRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["field", "event"]),
    field: z.enum(SCORING_FIELDS).optional().nullable(),
    operator: z.enum(SCORING_OPERATORS).optional().nullable(),
    value: z.unknown().optional().nullable(),
    event_type: z.enum(SCORING_EVENT_TYPES).optional().nullable(),
    window_days: z.number().int().min(1).max(3650).optional().nullable(),
    max_count: z.number().int().min(1).max(100).default(1),
    points: z.number().int().min(-100).max(100),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  })
  .refine((r) => r.kind !== "field" || (r.field && r.operator), {
    message: "Aturan field wajib punya field dan operator",
  })
  .refine((r) => r.kind !== "event" || Boolean(r.event_type), {
    message: "Aturan event wajib punya event_type",
  });
export type ScoringRuleInput = z.infer<typeof scoringRuleSchema>;

export interface ScoringRule {
  id: string;
  name: string;
  kind: "field" | "event";
  field: string | null;
  operator: ScoringOperator | null;
  value: unknown;
  event_type: string | null;
  window_days: number | null;
  max_count: number;
  points: number;
}

/** Snapshot lead (+ account) untuk aturan field. */
export type LeadScoringSnapshot = Partial<Record<ScoringField, string | null | undefined>>;

/**
 * Jumlah kejadian per kunci `${event_type}` atau `${event_type}:${sub}` —
 * mis. task_done:meeting, task_done:telepon, wa_inbound, deal_created.
 * Untuk aturan event dengan `value` (sub-jenis), kunci `${event_type}:${value}`
 * dipakai; tanpa value → kunci `${event_type}`.
 */
export type EventCounts = Record<string, number>;

export interface ScoreBreakdownItem {
  rule_id: string;
  name: string;
  points: number;
  /** untuk event: berapa kali dihitung */
  count?: number;
}

function normalize(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Evaluasi satu aturan field terhadap snapshot. */
export function matchFieldRule(rule: ScoringRule, snapshot: LeadScoringSnapshot): boolean {
  if (!rule.field || !rule.operator) return false;
  const raw = snapshot[rule.field as ScoringField];
  const actual = normalize(raw);
  switch (rule.operator) {
    case "not_empty":
      return actual.length > 0;
    case "eq":
      return actual === normalize(rule.value);
    case "neq":
      return actual !== normalize(rule.value);
    case "in":
      return Array.isArray(rule.value) && rule.value.map(normalize).includes(actual);
    case "contains":
      return normalize(rule.value).length > 0 && actual.includes(normalize(rule.value));
    case "gt":
      return Number(raw) > Number(rule.value);
    case "lt":
      return Number(raw) < Number(rule.value);
    default:
      return false;
  }
}

export function eventCountKey(rule: Pick<ScoringRule, "event_type" | "value">): string {
  const sub = typeof rule.value === "string" && rule.value.trim() ? `:${rule.value.trim().toLowerCase()}` : "";
  return `${rule.event_type}${sub}`;
}

/** Hitung skor + rincian. Aturan tidak aktif harus sudah disaring pemanggil. */
export function computeLeadScore(
  rules: ScoringRule[],
  snapshot: LeadScoringSnapshot,
  counts: EventCounts
): { score: number; breakdown: ScoreBreakdownItem[] } {
  const breakdown: ScoreBreakdownItem[] = [];
  for (const rule of rules) {
    if (rule.kind === "field") {
      if (matchFieldRule(rule, snapshot)) {
        breakdown.push({ rule_id: rule.id, name: rule.name, points: rule.points });
      }
      continue;
    }
    if (!rule.event_type) continue;
    const count = Math.min(counts[eventCountKey(rule)] ?? 0, Math.max(1, rule.max_count));
    if (count > 0) {
      breakdown.push({ rule_id: rule.id, name: rule.name, points: rule.points * count, count });
    }
  }
  const score = breakdown.reduce((acc, b) => acc + b.points, 0);
  return { score, breakdown };
}

export type ScoreBand = "hot" | "warm" | "cold";

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};
