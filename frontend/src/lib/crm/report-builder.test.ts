import { describe, expect, test } from "vitest";
import {
  REPORT_DATASET_DEFS,
  aggregateLabel,
  buildReportQuery,
  fieldDef,
  formatCellValue,
  reportDefinitionSchema,
  reportSchema,
  resolveDateRange,
  summarizeRows,
  type ReportDefinition,
} from "./report-builder";

const def = (over: Partial<ReportDefinition> = {}): ReportDefinition =>
  reportDefinitionSchema.parse({ dataset: "deal", ...over });

const TODAY = new Date(2026, 8, 13); // 13 September 2026

describe("report builder (EPIC-050 T-4.1)", () => {
  test("registry: tiap dataset punya field default yang valid & dateField terdaftar", () => {
    for (const [key, ds] of Object.entries(REPORT_DATASET_DEFS)) {
      expect(ds.fields[ds.dateField], `${key}.dateField`).toBeDefined();
      for (const col of ds.defaultColumns) expect(ds.fields[col], `${key}.${col}`).toBeDefined();
      if (ds.ownerExpr) expect(ds.ownerExpr).toMatch(/^[a-z]+\.owner_user_id$/);
    }
  });

  test("tiap field enum punya pilihan (nilai mengikuti CHECK constraint database)", () => {
    for (const [key, ds] of Object.entries(REPORT_DATASET_DEFS)) {
      for (const [fk, f] of Object.entries(ds.fields)) {
        if (f.type === "enum") expect(f.options?.length, `${key}.${fk}`).toBeGreaterThan(0);
      }
    }
    // Nilai berbahasa Indonesia — pernah salah ditulis dalam bahasa Inggris.
    expect(REPORT_DATASET_DEFS.lead.fields.temperature.options).toEqual(["panas", "hangat", "dingin"]);
    expect(REPORT_DATASET_DEFS.lead.fields.status.options).toEqual(["baru", "dihubungi", "qualified", "tidak-cocok"]);
  });

  test("mode tabel: kolom default, scope company, urutan & limit", () => {
    const q = buildReportQuery(def(), { companyId: "c1", today: TODAY });
    expect(q.grouped).toBe(false);
    expect(q.columns.map((c) => c.key)).toEqual([...REPORT_DATASET_DEFS.deal.defaultColumns]);
    expect(q.sql).toContain("t.company_id = $1");
    expect(q.sql).toContain("t.deleted_at IS NULL");
    expect(q.sql).toContain("LIMIT 500");
    expect(q.params).toEqual(["c1"]);
  });

  test("role sales dibatasi ke record miliknya", () => {
    const q = buildReportQuery(def(), { companyId: "c1", restrictOwnerUserId: "u9", today: TODAY });
    expect(q.sql).toContain("t.owner_user_id = $2");
    expect(q.params).toEqual(["c1", "u9"]);
  });

  test("mode agregasi: group by + sum, kolom hasil berlabel", () => {
    const q = buildReportQuery(
      def({ group_by: ["owner_name"], aggregates: [{ fn: "count" }, { fn: "sum", field: "value" }] }),
      { companyId: null, today: TODAY }
    );
    expect(q.grouped).toBe(true);
    expect(q.sql).toContain("GROUP BY ou.full_name");
    expect(q.sql).toContain('COUNT(*)::numeric AS "count"');
    expect(q.sql).toContain('SUM(COALESCE(t.value_final, t.value_estimate, 0))::numeric AS "sum_value"');
    expect(q.columns.map((c) => c.key)).toEqual(["owner_name", "count", "sum_value"]);
    expect(q.columns[2].label).toBe("Total Nilai Deal");
    expect(q.columns[2].type).toBe("currency");
  });

  test("group by field tanggal memakai bucket date_trunc", () => {
    const q = buildReportQuery(def({ group_by: ["created_at"], date_bucket: "month" }), { companyId: null, today: TODAY });
    expect(q.sql).toContain("date_trunc('month', t.created_at)::date");
    expect(q.columns[0].label).toContain("Bulanan");
    expect(q.columns[0].type).toBe("date");
  });

  test("field & agregasi tak dikenal dibuang, bukan disuntikkan ke SQL", () => {
    const q = buildReportQuery(
      def({ columns: ["title", "t.company_id; DROP TABLE x", "nope"], sort_field: "1=1" }),
      { companyId: null, today: TODAY }
    );
    expect(q.columns.map((c) => c.key)).toEqual(["title"]);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.sql).not.toContain("1=1");
  });

  test("group_by yang semuanya tak dikenal jatuh ke mode tabel", () => {
    const q = buildReportQuery(def({ group_by: ["tidak_ada"] }), { companyId: null, today: TODAY });
    expect(q.grouped).toBe(false);
  });

  test("sum/avg hanya untuk field aggregatable; count_distinct boleh field teks", () => {
    const q = buildReportQuery(
      def({ group_by: ["stage_name"], aggregates: [{ fn: "sum", field: "title" }, { fn: "count_distinct", field: "org_name" }] }),
      { companyId: null, today: TODAY }
    );
    expect(q.sql).not.toContain("SUM(t.title)");
    expect(q.sql).toContain("COUNT(DISTINCT l.org_name)");
  });

  test("filter: nilai lewat parameter, ILIKE dibungkus %, in pakai ANY", () => {
    const q = buildReportQuery(
      def({
        filters: [
          { field: "org_name", op: "contains", value: "PT Maju" },
          { field: "forecast_category", op: "in", value: ["commit", "best_case"] },
          { field: "value", op: "gte", value: "5000000" },
          { field: "lost_reason", op: "is_empty" },
        ],
      }),
      { companyId: null, today: TODAY }
    );
    expect(q.sql).toContain("l.org_name ILIKE $1");
    expect(q.sql).toContain("= ANY($2)");
    expect(q.sql).toContain(">= $3");
    expect(q.sql).toContain("lr.name IS NULL");
    expect(q.params[0]).toBe("%PT Maju%");
    expect(q.params[1]).toEqual(["commit", "best_case"]);
    expect(q.params[2]).toBe(5_000_000);
  });

  test("filter between & in kosong diabaikan", () => {
    const q = buildReportQuery(
      def({ filters: [{ field: "value", op: "between", value: 1, value2: 10 }, { field: "stage_name", op: "in", value: [] }] }),
      { companyId: null, today: TODAY }
    );
    expect(q.sql).toContain("BETWEEN $1 AND $2");
    expect(q.params).toEqual([1, 10]);
  });

  test("preset periode dihitung saat jalan, bukan saat simpan", () => {
    expect(resolveDateRange("all_time", {}, TODAY)).toBeNull();
    expect(resolveDateRange("today", {}, TODAY)).toEqual({ from: "2026-09-13", to: "2026-09-14" });
    expect(resolveDateRange("last_7_days", {}, TODAY)).toEqual({ from: "2026-09-07", to: "2026-09-14" });
    expect(resolveDateRange("this_month", {}, TODAY)).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(resolveDateRange("last_month", {}, TODAY)).toEqual({ from: "2026-08-01", to: "2026-09-01" });
    expect(resolveDateRange("this_quarter", {}, TODAY)).toEqual({ from: "2026-07-01", to: "2026-10-01" });
    expect(resolveDateRange("this_year", {}, TODAY)).toEqual({ from: "2026-01-01", to: "2027-01-01" });
    expect(resolveDateRange("last_year", {}, TODAY)).toEqual({ from: "2025-01-01", to: "2026-01-01" });
    expect(resolveDateRange("custom", { from: "2026-03-01", to: "2026-04-01" }, TODAY)).toEqual({ from: "2026-03-01", to: "2026-04-01" });
    expect(resolveDateRange("custom", { from: "2026-03-01" }, TODAY)).toBeNull();
    expect(resolveDateRange("this_month", {}, new Date(2026, 11, 5))).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });

  test("periode dipakai pada date_field pilihan", () => {
    const q = buildReportQuery(def({ date_field: "event_date", date_preset: "this_month" }), { companyId: null, today: TODAY });
    expect(q.sql).toContain("t.event_date >= $1::date");
    expect(q.sql).toContain("t.event_date < $2::date");
    expect(q.params).toEqual(["2026-09-01", "2026-10-01"]);
  });

  test("skema report menolak dataset asing & limit di luar batas", () => {
    expect(reportSchema.safeParse({ name: "A", definition: { dataset: "pegawai" } }).success).toBe(false);
    expect(reportDefinitionSchema.safeParse({ dataset: "lead", limit: 99999 }).success).toBe(false);
    expect(reportSchema.safeParse({ name: "A", definition: { dataset: "lead" } }).success).toBe(true);
  });

  test("ringkasan & format sel", () => {
    const cols = [
      { key: "owner_name", label: "PJ", type: "text" as const, isAggregate: false },
      { key: "sum_value", label: "Total Nilai", type: "currency" as const, isAggregate: true },
    ];
    expect(summarizeRows([], cols)).toBe("Tidak ada data.");
    expect(summarizeRows([{ owner_name: "Ani", sum_value: 5_000_000 }], cols)).toBe("• Ani — Total Nilai: Rp5.000.000");
    expect(formatCellValue("number", 1234)).toBe("1.234");
    expect(formatCellValue("number", 1.5)).toBe("1,5");
    expect(formatCellValue("date", "2026-10-04")).toBe("4 Okt 2026");
    expect(formatCellValue("datetime", "2026-10-04T07:30:00Z")).toBe("4 Okt 2026, 14.30");
    expect(formatCellValue("boolean", true)).toBe("Ya");
    expect(formatCellValue("text", null)).toBe("—");
    expect(aggregateLabel("deal", { fn: "avg", field: "value" })).toBe("Rata-rata Nilai Deal");
    expect(fieldDef("deal", "tidak_ada")).toBeNull();
  });
});
