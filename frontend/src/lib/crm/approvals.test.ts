import { describe, expect, test } from "vitest";
import {
  applyDiscount,
  canDecideStep,
  canReleaseQuotation,
  requiredApprovalLevels,
  type ApprovalRule,
} from "./approvals";

const RULES: ApprovalRule[] = [
  { id: "r1", level: 1, min_discount_percent: 10, approver_role: "admin", approver_user_id: null },
  { id: "r2", level: 2, min_discount_percent: 20, approver_role: "super_admin", approver_user_id: null },
];

describe("approval diskon quotation (EPIC-050 T-2.4)", () => {
  test("ambang default: ≤10% tanpa approval, 15% → admin, 25% → admin lalu owner", () => {
    expect(requiredApprovalLevels(10, RULES)).toEqual([]);
    expect(requiredApprovalLevels(15, RULES).map((r) => r.id)).toEqual(["r1"]);
    expect(requiredApprovalLevels(25, RULES).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  test("dua aturan di level sama → ambil ambang tertinggi yang terlewati", () => {
    const rules: ApprovalRule[] = [
      ...RULES,
      { id: "r1b", level: 1, min_discount_percent: 15, approver_role: "manager", approver_user_id: null },
    ];
    expect(requiredApprovalLevels(18, rules).map((r) => r.id)).toEqual(["r1b"]);
    expect(requiredApprovalLevels(12, rules).map((r) => r.id)).toEqual(["r1"]);
  });

  test("canDecideStep: role cocok, user ditunjuk, super_admin mewakili", () => {
    expect(canDecideStep({ approver_role: "admin", approver_user_id: null }, { id: "u", role: "admin" })).toBe(true);
    expect(canDecideStep({ approver_role: "admin", approver_user_id: null }, { id: "u", role: "sales" })).toBe(false);
    expect(canDecideStep({ approver_role: "admin", approver_user_id: null }, { id: "u", role: "super_admin" })).toBe(true);
    expect(canDecideStep({ approver_role: null, approver_user_id: "x" }, { id: "x", role: "sales" })).toBe(true);
    expect(canDecideStep({ approver_role: null, approver_user_id: "x" }, { id: "y", role: "super_admin" })).toBe(false);
  });

  test("applyDiscount: PPN dihitung dari DPP setelah diskon", () => {
    const r = applyDiscount(1_000_000, 15, true, 11);
    expect(r.discountNominal).toBe(150_000);
    expect(r.dpp).toBe(850_000);
    expect(r.ppnNominal).toBe(93_500);
    expect(r.total).toBe(943_500);
    expect(applyDiscount(1_000_000, 0, false, 11).total).toBe(1_000_000);
    expect(applyDiscount(1_000_000, 150, false, 0).discountNominal).toBe(1_000_000);
  });

  test("canReleaseQuotation", () => {
    expect(canReleaseQuotation("none")).toBe(true);
    expect(canReleaseQuotation("approved")).toBe(true);
    expect(canReleaseQuotation("pending")).toBe(false);
    expect(canReleaseQuotation("rejected")).toBe(false);
  });
});
