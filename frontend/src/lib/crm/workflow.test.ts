import { describe, expect, test } from "vitest";
import {
  evaluateConditions,
  pickRoundRobin,
  renderTemplate,
  splitAtWait,
  triggerForEvent,
  workflowRuleSchema,
  type WorkflowAction,
} from "./workflow";

describe("workflow rules — evaluator kondisi (EPIC-050 T-2.3)", () => {
  const record = { source: "wa", temperature: "hangat", score: 55, pic_email: "", owner_user_id: null };

  test("AND semua kondisi; tanpa kondisi selalu cocok", () => {
    expect(evaluateConditions([], record)).toBe(true);
    expect(
      evaluateConditions(
        [
          { field: "source", op: "eq", value: "WA" },
          { field: "score", op: "gte", value: 50 },
          { field: "pic_email", op: "is_empty" },
          { field: "owner_user_id", op: "is_empty" },
        ],
        record
      )
    ).toBe(true);
    expect(evaluateConditions([{ field: "temperature", op: "in", value: ["panas"] }], record)).toBe(false);
  });

  test("changed / changed_to memakai peta perubahan", () => {
    const changes = { temperature: { from: "hangat", to: "panas" } };
    expect(evaluateConditions([{ field: "temperature", op: "changed" }], record, changes)).toBe(true);
    expect(evaluateConditions([{ field: "temperature", op: "changed_to", value: "panas" }], record, changes)).toBe(true);
    expect(evaluateConditions([{ field: "source", op: "changed" }], record, changes)).toBe(false);
  });
});

describe("renderTemplate", () => {
  test("placeholder bersarang, angka id-ID, kunci tak dikenal kosong", () => {
    const out = renderTemplate("Halo {{owner.name}}, lead {{lead.org_name}} skor {{score}} ({{unknown.key}})", {
      owner: { name: "Ani" },
      lead: { org_name: "PT Kopi" },
      score: 1234,
    });
    expect(out).toBe("Halo Ani, lead PT Kopi skor 1.234 ()");
  });
});

describe("triggerForEvent / splitAtWait / round-robin", () => {
  test("pemetaan event → trigger", () => {
    expect(triggerForEvent("lead.created")).toEqual({ object: "lead", trigger: "created" });
    expect(triggerForEvent("deal.stage_changed")).toEqual({ object: "deal", trigger: "stage_changed" });
    expect(triggerForEvent("task.done")).toEqual({ object: "task", trigger: "status_changed" });
    expect(triggerForEvent("lead.score_changed")).toEqual({ object: "lead", trigger: "score_reached" });
    expect(triggerForEvent("member.created")).toBeNull();
  });

  test("splitAtWait memisah aksi & menghitung delay", () => {
    const actions: WorkflowAction[] = [
      { type: "notify_in_app", to: "owner", title: "a", message: "b" },
      { type: "wait", days: 1, hours: 2 },
      { type: "send_wa", to: "owner", message: "x" },
    ];
    const { now, later, delayMs } = splitAtWait(actions);
    expect(now).toHaveLength(1);
    expect(later).toHaveLength(1);
    expect(delayMs).toBe(26 * 3_600_000);
    expect(splitAtWait([actions[0]]).delayMs).toBe(0);
  });

  test("round-robin deterministik", () => {
    expect(pickRoundRobin(["a", "b", "c"], 4)).toBe("b");
    expect(pickRoundRobin([], 0)).toBeNull();
  });
});

describe("workflowRuleSchema", () => {
  test("update_field hanya field whitelist per objek", () => {
    const base = { name: "r", object: "lead", trigger_type: "created", actions: [{ type: "update_field", field: "status", value: "dihubungi" }] };
    expect(workflowRuleSchema.safeParse(base).success).toBe(true);
    expect(
      workflowRuleSchema.safeParse({ ...base, actions: [{ type: "update_field", field: "owner_user_id", value: "x" }] }).success
    ).toBe(false);
  });

  test("inactive_days & score_reached butuh konfigurasi", () => {
    const act = [{ type: "notify_in_app", to: "owner", title: "t", message: "m" }];
    expect(workflowRuleSchema.safeParse({ name: "r", object: "lead", trigger_type: "inactive_days", actions: act }).success).toBe(false);
    expect(
      workflowRuleSchema.safeParse({ name: "r", object: "lead", trigger_type: "inactive_days", trigger_config: { days: 3 }, actions: act }).success
    ).toBe(true);
    expect(
      workflowRuleSchema.safeParse({ name: "r", object: "lead", trigger_type: "score_reached", trigger_config: { score: 70 }, actions: act }).success
    ).toBe(true);
  });
});
