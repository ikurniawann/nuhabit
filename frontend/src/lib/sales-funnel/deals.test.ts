import { describe, expect, it } from "vitest";
import { planStageMove } from "./deals";

const NOW = "2026-10-04T07:00:00.000Z";
const open = { is_won: false, is_lost: false, probability: 60 };
const won = { is_won: true, is_lost: false, probability: 100 };
const lost = { is_won: false, is_lost: true, probability: 0 };

describe("planStageMove", () => {
  it("tahap berjalan: reset alasan kalah & closed_at, kategori dari probability", () => {
    const plan = planStageMove(open, { stage_id: "s2", lost_reason_id: "r1" }, { value_final: null, event_date: null }, NOW);
    expect(plan.body.lost_reason_id).toBeNull();
    expect(plan.columns).toEqual({ forecast_category: "best_case", closed_at: null, entered_stage_at: NOW });
  });

  it("kategori forecast manual tidak ditimpa", () => {
    const plan = planStageMove(open, { stage_id: "s2", forecast_category: "commit" }, { value_final: null, event_date: null }, NOW);
    expect(plan.columns).not.toHaveProperty("forecast_category");
  });

  it("menang wajib nilai final & tanggal acara", () => {
    expect(() => planStageMove(won, { stage_id: "w" }, { value_final: null, event_date: "2026-11-01" }, NOW)).toThrow(
      "Deal Menang wajib diisi nilai final"
    );
    expect(() => planStageMove(won, { stage_id: "w", value_final: 5_000_000 }, { value_final: null, event_date: null }, NOW)).toThrow(
      "Deal Menang wajib punya tanggal acara fix"
    );
  });

  it("menang: tanggal jadi fix, alasan kalah dibuang, closed_at diisi", () => {
    const plan = planStageMove(won, { stage_id: "w", lost_reason_id: "r1" }, { value_final: "5000000", event_date: "2026-11-01" }, NOW);
    expect(plan.body).toMatchObject({ is_event_date_fixed: true, lost_reason_id: null });
    expect(plan.columns).toEqual({ forecast_category: "closed_won", closed_at: NOW, entered_stage_at: NOW });
  });

  it("kalah wajib alasan", () => {
    expect(() => planStageMove(lost, { stage_id: "l" }, { value_final: null, event_date: null }, NOW)).toThrow(
      "Deal Kalah wajib pilih alasan kalah"
    );
    const plan = planStageMove(lost, { stage_id: "l", lost_reason_id: "r1" }, { value_final: null, event_date: null }, NOW);
    expect(plan.body.lost_reason_id).toBe("r1");
    expect(plan.columns.closed_at).toBe(NOW);
  });
});
