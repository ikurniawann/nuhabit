import { describe, expect, it } from "vitest";
import { buildSystemSummary, createEmptySystemSummary, detectIntent, generateSummaryAnswer, type DbAdmin } from "./summary";

describe("detectIntent", () => {
  it.each([
    ["Bagaimana KPI tim bulan ini?", "performance"],
    ["Total gaji karyawan", "payroll"],
    ["Berapa stok bahan baku?", "inventory"],
    ["Kandidat baru hari ini", "hris"],
    ["Halo", "all"],
  ])("%s → %s", (message, intent) => {
    expect(detectIntent(message)).toBe(intent);
  });
});

describe("generateSummaryAnswer", () => {
  const summary = {
    ...createEmptySystemSummary(),
    hris: { candidatesTotal: 12, candidatesToday: 2 },
    details: { hris: [{ id: "c1", full_name: "Sari", status: "applied" }] },
  };

  it("intent spesifik hanya merangkum modulnya plus baris terbaru", () => {
    const answer = generateSummaryAnswer("kandidat", summary, "Budi", "hris");
    expect(answer).toContain("HRIS: 12 total kandidat, 2 kandidat masuk hari ini");
    expect(answer).toContain("Kandidat terbaru: c1 | Sari | applied");
    expect(answer).not.toContain("Payroll:");
  });

  it("intent all menyapa user dan memuat semua modul", () => {
    const answer = generateSummaryAnswer("ringkas", summary, "Budi", "all");
    expect(answer.startsWith("Halo Budi")).toBe(true);
    expect(answer).toContain("Payroll: 0 payroll run");
  });
});

describe("buildSystemSummary", () => {
  // Kolom nyata (information_schema) dari tabel yang dibaca baris detailnya.
  // Pembacaan summary gagal diam-diam, jadi kolom basi hanya terlihat sebagai
  // konteks kosong.
  const schema: Record<string, string[]> = {
    candidates: ["id", "full_name", "status", "source", "created_at"],
    performance_reviews: ["id", "period_label", "status", "grand_total_score", "created_at"],
    payroll_runs: ["id", "run_name", "period_month", "period_year", "status", "created_at"],
    purchase_orders: ["id", "nomor_po", "status", "total", "created_at"],
    inventory: ["id", "raw_material_id", "qty_available", "qty_minimum", "updated_at"],
    pos_orders: ["id", "order_number", "status", "total_amount", "created_at"],
    ai_assistant_logs: ["id", "user_email", "intent", "model", "latency_ms", "created_at"],
    departments: ["id", "name", "created_at"],
  };

  it("baris detail hanya membaca kolom yang ada", async () => {
    const used: Array<[string, string]> = [];
    const admin = {
      from: (table: string) => ({
        select: (columns = "") => {
          const query: Record<string, unknown> = {};
          const use = (column: string) => {
            used.push([table, column]);
            return query;
          };
          columns.split(",").forEach((c) => used.push([table, c.trim()]));
          Object.assign(query, {
            eq: use,
            gte: use,
            lt: use,
            in: use,
            order: use,
            limit: () => query,
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok),
          });
          return query;
        },
      }),
    } as unknown as DbAdmin;
    await buildSystemSummary(admin, "all");
    const stale = used.filter(([table, column]) => schema[table] && !schema[table].includes(column));
    expect(stale).toEqual([]);
  });
});
