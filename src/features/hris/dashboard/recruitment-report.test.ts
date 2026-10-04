import { describe, expect, it } from "vitest";
import { buildRecruitmentReportHtml, csvCell } from "./recruitment-report";

describe("buildRecruitmentReportHtml", () => {
  it("escapes candidate fields from the public career form", () => {
    const html = buildRecruitmentReportHtml({
      periodLabel: "Oktober 2026",
      summary: { thisMonth: 3, activePipeline: 2, talentPool: 1, openPositions: 4 },
      pipelineFunnel: [{ name: "<b>applied</b>", value: 3 }],
      needsAttention: [
        {
          full_name: `<img src=x onerror="opener.location='//evil'">`,
          position_title: "Barista",
          brand_name: null,
          status: "screening",
          days_in_current_status: 9,
        },
      ],
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>applied");
    expect(html).toContain("&lt;img src=x onerror=&quot;opener.location=&#39;//evil&#39;&quot;&gt;");
    expect(html).toContain("<td>9 hari</td>");
    expect(html).toContain("Oktober 2026");
  });
});

describe("csvCell", () => {
  it("doubles quotes and neutralises spreadsheet formulas", () => {
    expect(csvCell('Budi "B"')).toBe('"Budi ""B"""');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+62812")).toBe("\"'+62812\"");
    expect(csvCell(null)).toBe('""');
  });
});
