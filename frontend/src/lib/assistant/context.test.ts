import { describe, expect, it } from "vitest";
import {
  contextSizeChars,
  INTENT_MODULES,
  selectContextForIntent,
  type AssistantSummaryLike,
} from "./context";

function makeSummary(): AssistantSummaryLike {
  const metrics = (n: number) => ({ a: n, b: n + 1, c: n + 2, d: n + 3 });
  return {
    generatedAt: "2026-07-21T00:00:00.000Z",
    modules: {
      hris: { label: "HRIS", metrics: metrics(1) },
      performance: { label: "Performance", metrics: metrics(10) },
      payroll: { label: "Payroll", metrics: metrics(20) },
      procurement: { label: "Procurement", metrics: metrics(30) },
      inventory: { label: "Inventory", metrics: metrics(40) },
      pos: { label: "POS", metrics: metrics(50) },
      master: { label: "Master Data", metrics: metrics(60) },
      integration: { label: "Integration", metrics: metrics(70) },
    },
    details: {
      hris: [{ id: "c1", full_name: "Ani", status: "applied" }],
      pos: [{ id: "o1", order_number: "PO-1", total_amount: 24000 }],
      inventory: [{ id: "i1", current_stock: 2, minimum_stock: 5 }],
    },
  };
}

describe("selectContextForIntent", () => {
  it("hanya membawa modul yang relevan dengan intent", () => {
    const selected = selectContextForIntent(makeSummary(), "pos");
    expect(Object.keys(selected.modul).sort()).toEqual(["inventory", "pos"]);
  });

  it("membawa seluruh modul untuk intent all", () => {
    const selected = selectContextForIntent(makeSummary(), "all");
    expect(Object.keys(selected.modul)).toHaveLength(INTENT_MODULES.all.length);
  });

  it("menyertakan rincian baris hanya untuk modul terpilih", () => {
    const selected = selectContextForIntent(makeSummary(), "pos");
    expect(Object.keys(selected.rincian).sort()).toEqual(["inventory", "pos"]);
    expect(selected.rincian.hris).toBeUndefined();
  });

  it("mengabaikan rincian kosong agar tidak mengirim array hampa", () => {
    const summary = makeSummary();
    summary.details.pos = [];
    const selected = selectContextForIntent(summary, "pos");
    expect(selected.rincian.pos).toBeUndefined();
  });

  it("tidak error saat modul yang diminta tidak ada di summary", () => {
    const summary = makeSummary();
    summary.modules = {};
    const selected = selectContextForIntent(summary, "payroll");
    expect(selected.modul).toEqual({});
  });

  it("intent tak dikenal diperlakukan seperti all", () => {
    // Nilai bisa datang dari data lama; jangan sampai konteksnya jadi kosong.
    const selected = selectContextForIntent(makeSummary(), "entah" as never);
    expect(Object.keys(selected.modul)).toHaveLength(INTENT_MODULES.all.length);
  });

  it("mempertahankan tanggal pembuatan ringkasan", () => {
    expect(selectContextForIntent(makeSummary(), "hris").dibuatPada).toBe(
      "2026-07-21T00:00:00.000Z"
    );
  });
});

describe("penghematan payload", () => {
  it("intent spesifik jauh lebih kecil daripada mengirim seluruh summary", () => {
    const summary = makeSummary();
    // Bentuk lama: seluruh objek summary, termasuk duplikasi metrik di
    // top-level DAN di modules.*.metrics.
    const legacy = {
      generatedAt: summary.generatedAt,
      ...Object.fromEntries(
        Object.entries(summary.modules).map(([key, mod]) => [key, mod.metrics])
      ),
      modules: summary.modules,
      details: summary.details,
    };

    const before = contextSizeChars(legacy);
    const after = contextSizeChars(selectContextForIntent(summary, "pos"));

    expect(after).toBeLessThan(before / 2);
  });

  it("intent all tetap lebih kecil karena duplikasi top-level hilang", () => {
    const summary = makeSummary();
    const legacy = {
      generatedAt: summary.generatedAt,
      ...Object.fromEntries(
        Object.entries(summary.modules).map(([key, mod]) => [key, mod.metrics])
      ),
      modules: summary.modules,
      details: summary.details,
    };
    expect(contextSizeChars(selectContextForIntent(summary, "all"))).toBeLessThan(
      contextSizeChars(legacy)
    );
  });
});
