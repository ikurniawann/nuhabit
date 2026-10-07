import { describe, expect, test } from "vitest";
import {
  computeLeadScore,
  eventCountKey,
  matchFieldRule,
  scoreBand,
  scoringRuleSchema,
  type ScoringRule,
} from "./scoring";

const rule = (partial: Partial<ScoringRule> & Pick<ScoringRule, "id" | "name" | "kind" | "points">): ScoringRule => ({
  field: null,
  operator: null,
  value: null,
  event_type: null,
  window_days: null,
  max_count: 1,
  ...partial,
});

describe("lead scoring (EPIC-050 T-2.2)", () => {
  test("aturan field: eq/in/not_empty/contains case-insensitive", () => {
    const snap = { source: "WA", org_type: "corporate", pic_email: "a@b.id", city: "Kota Bandung" };
    expect(matchFieldRule(rule({ id: "1", name: "x", kind: "field", points: 1, field: "source", operator: "eq", value: "wa" }), snap)).toBe(true);
    expect(matchFieldRule(rule({ id: "2", name: "x", kind: "field", points: 1, field: "org_type", operator: "in", value: ["sekolah", "Corporate"] }), snap)).toBe(true);
    expect(matchFieldRule(rule({ id: "3", name: "x", kind: "field", points: 1, field: "pic_email", operator: "not_empty" }), snap)).toBe(true);
    expect(matchFieldRule(rule({ id: "4", name: "x", kind: "field", points: 1, field: "city", operator: "contains", value: "bandung" }), snap)).toBe(true);
    expect(matchFieldRule(rule({ id: "5", name: "x", kind: "field", points: 1, field: "temperature", operator: "eq", value: "panas" }), snap)).toBe(false);
  });

  test("skor = Σ field + event × count (dibatasi max_count)", () => {
    const rules: ScoringRule[] = [
      rule({ id: "a", name: "Sumber WA", kind: "field", points: 10, field: "source", operator: "eq", value: "wa" }),
      rule({ id: "b", name: "Meeting", kind: "event", points: 20, event_type: "task_done", value: "meeting", max_count: 2 }),
      rule({ id: "c", name: "Balasan WA", kind: "event", points: 10, event_type: "wa_inbound", max_count: 3 }),
      rule({ id: "d", name: "Deal", kind: "event", points: 20, event_type: "deal_created" }),
    ];
    const { score, breakdown } = computeLeadScore(
      rules,
      { source: "wa" },
      { "task_done:meeting": 5, wa_inbound: 2, "task_done:telepon": 9 }
    );
    // 10 + 20×2 (cap) + 10×2 + 0
    expect(score).toBe(70);
    expect(breakdown.map((b) => b.rule_id)).toEqual(["a", "b", "c"]);
    expect(breakdown[1].count).toBe(2);
  });

  test("eventCountKey memakai sub-jenis dari value", () => {
    expect(eventCountKey({ event_type: "task_done", value: "Meeting " })).toBe("task_done:meeting");
    expect(eventCountKey({ event_type: "wa_inbound", value: null })).toBe("wa_inbound");
  });

  test("scoreBand", () => {
    expect(scoreBand(70)).toBe("hot");
    expect(scoreBand(40)).toBe("warm");
    expect(scoreBand(39)).toBe("cold");
  });

  test("skema aturan menolak field tanpa operator dan event tanpa jenis", () => {
    expect(scoringRuleSchema.safeParse({ name: "x", kind: "field", field: "source", points: 5 }).success).toBe(false);
    expect(scoringRuleSchema.safeParse({ name: "x", kind: "event", points: 5 }).success).toBe(false);
    expect(scoringRuleSchema.safeParse({ name: "x", kind: "event", event_type: "wa_inbound", points: 5 }).success).toBe(true);
  });
});
