import { describe, expect, test } from "vitest";
import { aggregateForecast, categoryFromStage, monthRange, splitTargets, sumForecast, targetSchema } from "./forecast";

describe("forecast & target (EPIC-050 T-3.2)", () => {
  test("kategori dari tahap: menang/kalah/commit≥75/best_case≥50/pipeline", () => {
    expect(categoryFromStage({ is_won: true, is_lost: false, probability: 100 })).toBe("closed_won");
    expect(categoryFromStage({ is_won: false, is_lost: true, probability: 0 })).toBe("closed_lost");
    expect(categoryFromStage({ is_won: false, is_lost: false, probability: 75 })).toBe("commit");
    expect(categoryFromStage({ is_won: false, is_lost: false, probability: 50 })).toBe("best_case");
    expect(categoryFromStage({ is_won: false, is_lost: false, probability: 49 })).toBe("pipeline");
  });

  test("monthRange termasuk lompat tahun", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });

  test("agregasi per PJ: menang, weighted, kategori, attainment & gap", () => {
    const rows = aggregateForecast(
      [
        { owner_user_id: "u1", owner_name: "Ani", pipeline_id: null, value: 10_000_000, probability: 100, category: "closed_won" },
        { owner_user_id: "u1", owner_name: "Ani", pipeline_id: null, value: 20_000_000, probability: 75, category: "commit" },
        { owner_user_id: "u1", owner_name: "Ani", pipeline_id: null, value: 8_000_000, probability: 50, category: "best_case" },
        { owner_user_id: "u1", owner_name: "Ani", pipeline_id: null, value: 5_000_000, probability: 0, category: "closed_lost" },
        { owner_user_id: null, owner_name: null, pipeline_id: null, value: 4_000_000, probability: 10, category: "pipeline" },
      ],
      [{ user_id: "u1", target_value: 50_000_000, target_deals: 3 }],
      [{ id: "u1", name: "Ani" }, { id: "u2", name: "Budi" }]
    );
    const ani = rows.find((r) => r.user_id === "u1")!;
    expect(ani.won_value).toBe(10_000_000);
    expect(ani.won_deals).toBe(1);
    expect(ani.commit_value).toBe(20_000_000);
    expect(ani.best_case_value).toBe(8_000_000);
    expect(ani.weighted_value).toBe(15_000_000 + 4_000_000);
    expect(ani.open_deals).toBe(2);
    expect(ani.attainment_percent).toBe(58); // (10 + 19) / 50
    expect(ani.gap).toBe(21_000_000);
    const budi = rows.find((r) => r.user_id === "u2")!;
    expect(budi.won_value).toBe(0);
    const none = rows[rows.length - 1];
    expect(none.user_id).toBeNull();
    expect(none.pipeline_value).toBe(4_000_000);
    const total = sumForecast(rows);
    expect(total.target_value).toBe(50_000_000);
    expect(total.weighted_value).toBe(19_400_000);
  });

  test("target perusahaan (user_id null): dipisah, jadi total, alokasi = Σ salesperson", () => {
    const targets = [
      { user_id: "u1", target_value: 30_000_000, target_deals: 2 },
      { user_id: "u2", target_value: 20_000_000, target_deals: null },
      { user_id: null, target_value: 80_000_000, target_deals: 5 },
    ];
    const { company, users } = splitTargets(targets);
    expect(company).toEqual({ target_value: 80_000_000, target_deals: 5 });
    expect(users.map((u) => u.user_id)).toEqual(["u1", "u2"]);
    const rows = aggregateForecast(
      [{ owner_user_id: "u1", owner_name: "Ani", pipeline_id: null, value: 40_000_000, probability: 100, category: "closed_won" }],
      targets,
      [{ id: "u1", name: "Ani" }, { id: "u2", name: "Budi" }]
    );
    expect(rows.find((r) => r.user_id === null)).toBeUndefined();
    expect(rows.find((r) => r.user_id === "u1")!.target_value).toBe(30_000_000);
    const total = sumForecast(rows, company);
    expect(total.company_target_set).toBe(true);
    expect(total.target_value).toBe(80_000_000);
    expect(total.target_deals).toBe(5);
    expect(total.allocated_target_value).toBe(50_000_000);
    expect(total.attainment_percent).toBe(50);
    expect(total.gap).toBe(40_000_000);
    const noCompany = sumForecast(rows, null);
    expect(noCompany.company_target_set).toBe(false);
    expect(noCompany.target_value).toBe(50_000_000);
    expect(noCompany.allocated_target_value).toBe(50_000_000);
  });

  test("targetSchema format bulan & user_id null (perusahaan)", () => {
    expect(targetSchema.safeParse({ user_id: null, period_month: "2026-09", target_value: 100 }).success).toBe(true);
    expect(targetSchema.safeParse({ user_id: "11111111-1111-4111-8111-111111111111", period_month: "2026-09", target_value: 1 }).success).toBe(true);
    expect(targetSchema.safeParse({ user_id: "11111111-1111-4111-8111-111111111111", period_month: "2026-9", target_value: 1 }).success).toBe(false);
  });
});
