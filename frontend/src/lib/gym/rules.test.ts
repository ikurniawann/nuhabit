import { describe, expect, it, vi } from "vitest";
import {
  GYM_RULE_DEFAULTS,
  GYM_RULE_KEYS,
  getGymRules,
  resolveGymRules,
  sanitizeStoredRules,
  validateGymRules,
  validateGymRulesPatch,
} from "./rules";

describe("GYM_RULE_DEFAULTS", () => {
  it("matches the schema contract", () => {
    expect(GYM_RULE_DEFAULTS).toEqual({
      creditExpiryDays: 60,
      cancellationDeadlineHours: 4,
      lateCancelPolicy: "forfeit",
      noShowPolicy: "forfeit",
      reEntryGraceMin: 15,
      antiPassbackMin: 60,
      qrTtlSec: 45,
      waitlistAutoPromote: true,
      lowBalanceThreshold: 3,
      expiryReminderDays: 7,
      bookingOpensDaysBefore: 7,
      bookingClosesMinBefore: 0,
    });
    expect(GYM_RULE_KEYS).toHaveLength(12);
  });
});

describe("resolveGymRules", () => {
  it("layers defaults, global, then branch override", () => {
    const rules = resolveGymRules({ qrTtlSec: 30, noShowPolicy: "free" }, { qrTtlSec: 60 });
    expect(rules).toEqual({ ...GYM_RULE_DEFAULTS, qrTtlSec: 60, noShowPolicy: "free" });
  });

  it("falls back to defaults when nothing is stored", () => {
    expect(resolveGymRules(undefined, undefined)).toEqual(GYM_RULE_DEFAULTS);
    expect(resolveGymRules(null, "garbage")).toEqual(GYM_RULE_DEFAULTS);
  });

  it("ignores unknown keys and invalid stored values", () => {
    expect(sanitizeStoredRules({ qrTtlSec: 5, creditExpiryDays: "60", foo: 1, lateCancelPolicy: "free" })).toEqual({
      lateCancelPolicy: "free",
    });
    expect(sanitizeStoredRules([1, 2])).toEqual({});
  });
});

describe("validateGymRules", () => {
  it("accepts the defaults", () => {
    expect(validateGymRules(GYM_RULE_DEFAULTS)).toEqual({ ok: true, rules: GYM_RULE_DEFAULTS });
  });

  it("requires every key for the global rules", () => {
    const partial: Record<string, unknown> = { ...GYM_RULE_DEFAULTS };
    delete partial.qrTtlSec;
    const result = validateGymRules(partial);
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range values with the key name", () => {
    const result = validateGymRules({ ...GYM_RULE_DEFAULTS, qrTtlSec: 5 });
    expect(result).toEqual({ ok: false, error: "qrTtlSec: Umur QR minimal 10" });
    expect(validateGymRules({ ...GYM_RULE_DEFAULTS, creditExpiryDays: 0 }).ok).toBe(false);
    expect(validateGymRules({ ...GYM_RULE_DEFAULTS, expiryReminderDays: 0 }).ok).toBe(false);
    expect(validateGymRules({ ...GYM_RULE_DEFAULTS, cancellationDeadlineHours: 1.5 }).ok).toBe(false);
    expect(validateGymRules({ ...GYM_RULE_DEFAULTS, lateCancelPolicy: "charge" }).ok).toBe(false);
  });
});

describe("validateGymRulesPatch", () => {
  it("accepts a partial override", () => {
    expect(validateGymRulesPatch({ antiPassbackMin: 30 })).toEqual({ ok: true, rules: { antiPassbackMin: 30 } });
    expect(validateGymRulesPatch({})).toEqual({ ok: true, rules: {} });
  });

  it("rejects unknown keys", () => {
    expect(validateGymRulesPatch({ antiPassback: 30 })).toEqual({
      ok: false,
      error: "Kunci aturan tidak dikenal: antiPassback",
    });
  });

  it("rejects wrong types", () => {
    expect(validateGymRulesPatch({ waitlistAutoPromote: "yes" }).ok).toBe(false);
  });
});

describe("getGymRules", () => {
  it("merges the global row and the branch row from the client", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { branch_id: null, rules: { qrTtlSec: 30 } },
        { branch_id: "b1", rules: { qrTtlSec: 90, lowBalanceThreshold: 1 } },
      ],
    });
    const rules = await getGymRules({ query } as never, "b1");
    expect(rules.qrTtlSec).toBe(90);
    expect(rules.lowBalanceThreshold).toBe(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("gym.business_rules"), ["b1"]);
  });

  it("returns global rules when no branch is given", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ branch_id: null, rules: { qrTtlSec: 30 } }] });
    expect((await getGymRules({ query } as never)).qrTtlSec).toBe(30);
    expect(query).toHaveBeenCalledWith(expect.any(String), [null]);
  });
});
