import { describe, expect, test } from "vitest";
import {
  RFM_PRESETS,
  SEGMENT_SOURCE_DEFS,
  buildSegmentQuery,
  buildSegmentWhere,
  describeSegment,
  matchRfmPreset,
  segmentDefinitionSchema,
  segmentFieldDef,
  segmentSchema,
  type SegmentDefinition,
} from "./segments";

const def = (over: Partial<SegmentDefinition> = {}): SegmentDefinition =>
  segmentDefinitionSchema.parse({ source: "member", ...over });

describe("segmen dinamis & RFM (EPIC-050 T-5.1)", () => {
  test("registry: field RFM tersedia di sumber yang mendukungnya", () => {
    for (const [key, src] of Object.entries(SEGMENT_SOURCE_DEFS)) {
      if (!src.supportsRfm) continue;
      for (const f of ["last_visit", "visit_count", "total_spent"]) {
        expect(src.fields[f], `${key}.${f}`).toBeDefined();
      }
    }
    expect(SEGMENT_SOURCE_DEFS.member.supportsRfm).toBe(true);
    expect(SEGMENT_SOURCE_DEFS.lead.supportsRfm).toBe(false);
  });

  test("tanpa RFM: query sederhana, buang penerima tanpa nomor", () => {
    const q = buildSegmentQuery(def(), { companyId: null });
    expect(q.withRfm).toBe(false);
    expect(q.sql).not.toContain("NTILE");
    expect(q.sql).toContain("t.phone IS NOT NULL");
    expect(q.sql).toContain("LIMIT 5000");
  });

  test("dengan RFM: NTILE 5 dan penyaringan skor", () => {
    const q = buildSegmentQuery(def({ rfm: RFM_PRESETS.champions.rfm }), { companyId: null });
    expect(q.withRfm).toBe(true);
    expect(q.sql).toContain("NTILE(5) OVER (ORDER BY b.last_visit ASC NULLS FIRST)");
    expect(q.sql).toContain("r_score BETWEEN 4 AND 5");
    expect(q.sql).toContain("f_score BETWEEN 4 AND 5");
    expect(q.sql).toContain("m_score BETWEEN 4 AND 5");
  });

  test("RFM diabaikan pada sumber yang tidak mendukungnya", () => {
    const q = buildSegmentQuery(def({ source: "lead", rfm: RFM_PRESETS.champions.rfm }), { companyId: "c1" });
    expect(q.withRfm).toBe(false);
    expect(q.sql).not.toContain("NTILE");
  });

  test("skor di luar 1–5 dijepit, tidak masuk SQL apa adanya", () => {
    // Sengaja melewati zod: meniru baris lama di database yang skornya di luar
    // rentang. Skor diinterpolasi ke SQL, jadi penjepitan wajib ada di builder.
    const raw = { ...def(), rfm: { enabled: true, recency: { min: -99, max: 99 }, frequency: { min: 1, max: 5 }, monetary: { min: 1, max: 5 } } } as SegmentDefinition;
    const q = buildSegmentQuery(raw, { companyId: null });
    expect(q.sql).toContain("r_score BETWEEN 1 AND 5");
    expect(q.sql).not.toContain("-99");
    expect(q.sql).not.toContain("99");
  });

  test("company scope hanya diterapkan bila sumbernya punya company_id", () => {
    const member = buildSegmentQuery(def(), { companyId: "c1" });
    expect(member.params).toEqual([]); // pos_customers lintas venue
    const lead = buildSegmentQuery(def({ source: "lead" }), { companyId: "c1" });
    expect(lead.sql).toContain("t.company_id = $1");
    expect(lead.params).toEqual(["c1"]);
  });

  test("filter: nilai lewat parameter, field asing dibuang", () => {
    const q = buildSegmentQuery(
      def({
        filters: [
          { field: "city", op: "contains", value: "Bandung" },
          { field: "total_spent", op: "gte", value: "500000" },
          { field: "t.id; DROP TABLE pos.pos_customers", op: "eq", value: "x" },
        ],
      }),
      { companyId: null }
    );
    expect(q.sql).toContain("t.city ILIKE $1");
    expect(q.sql).toContain(">= $2");
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toEqual(["%Bandung%", 500_000]);
  });

  test("require_wa_consent menambah syarat izin", () => {
    const q = buildSegmentQuery(def({ require_wa_consent: true }), { companyId: null });
    expect(q.sql).toContain("COALESCE(t.wa_consent, false)");
  });

  test("countOnly menghasilkan COUNT, bukan daftar", () => {
    const q = buildSegmentQuery(def(), { companyId: null, countOnly: true });
    expect(q.sql).toContain("COUNT(*)::int AS total");
    const withRfm = buildSegmentQuery(def({ rfm: RFM_PRESETS.at_risk.rfm }), { companyId: null, countOnly: true });
    expect(withRfm.sql).toContain("COUNT(*)::int AS total");
    expect(withRfm.sql).toContain("NTILE");
  });

  test("fragment WHERE untuk kampanye: alias diganti, nomor parameter digeser", () => {
    const f = buildSegmentWhere(def({ filters: [{ field: "city", op: "eq", value: "Bandung" }] }), { alias: "c", startIndex: 4, companyId: null });
    expect(f.where).toContain("c.city = $4");
    expect(f.where).not.toContain("t.city");
    expect(f.where).not.toContain("ORDER BY");
    expect(f.where).not.toContain("LIMIT");
    expect(f.params).toEqual(["Bandung"]);
  });

  test("fragment WHERE dengan RFM memakai subquery IN", () => {
    const f = buildSegmentWhere(def({ rfm: RFM_PRESETS.at_risk.rfm }), { alias: "c", startIndex: 4, companyId: null });
    expect(f.where).toMatch(/^c\.id IN \(SELECT id FROM \(/);
    expect(f.where).toContain("NTILE(5)");
    expect(f.where).toContain("r_score BETWEEN 1 AND 2");
    expect(f.where).not.toContain("ORDER BY m_score");
  });

  test("preset RFM: semua valid & bisa dikenali kembali", () => {
    for (const [key, preset] of Object.entries(RFM_PRESETS)) {
      expect(preset.rfm.enabled, key).toBe(true);
      expect(matchRfmPreset(preset.rfm)).toBe(key);
    }
    expect(matchRfmPreset({ enabled: false, recency: { min: 1, max: 5 }, frequency: { min: 1, max: 5 }, monetary: { min: 1, max: 5 } })).toBeNull();
  });

  test("skema menolak sumber asing & skor di luar rentang", () => {
    expect(segmentSchema.safeParse({ name: "A", definition: { source: "karyawan" } }).success).toBe(false);
    expect(segmentDefinitionSchema.safeParse({ source: "member", rfm: { enabled: true, recency: { min: 0, max: 5 } } }).success).toBe(false);
    expect(segmentSchema.safeParse({ name: "A", definition: { source: "member" } }).success).toBe(true);
  });

  test("deskripsi segmen & lookup field", () => {
    expect(describeSegment(def({ filters: [{ field: "city", op: "eq", value: "Bandung" }], rfm: RFM_PRESETS.champions.rfm, require_wa_consent: true })))
      .toBe("Member & Pelanggan · 1 filter · RFM R4–5 F4–5 M4–5 · hanya izin WA");
    expect(describeSegment(def())).toBe("Member & Pelanggan");
    expect(segmentFieldDef("member", "tidak_ada")).toBeNull();
    expect(segmentFieldDef("member", "total_spent")?.type).toBe("currency");
  });
});
