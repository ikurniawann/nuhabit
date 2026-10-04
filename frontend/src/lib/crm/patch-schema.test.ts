import { describe, expect, it } from "vitest";
import { z } from "zod";
import { customFieldSchema } from "./custom-fields";
import { patchSchemaOf } from "./patch-schema";
import { publicFormSchema } from "./public-forms";
import { reportScheduleSchema } from "./report-schedule";
import { scoringRuleSchema } from "./scoring";

describe("patchSchemaOf", () => {
  it("tidak mengisi default untuk field yang tidak dikirim", () => {
    const base = z.object({ name: z.string(), sort_order: z.number().default(0), is_active: z.boolean().default(true) });
    expect(patchSchemaOf(base).parse({ is_active: false })).toEqual({ is_active: false });
  });

  it("bisa dipakai pada skema ber-refine (zod .partial() melempar di sini)", () => {
    expect(() => scoringRuleSchema.partial()).toThrow();
    expect(patchSchemaOf(scoringRuleSchema).parse({ points: 5 })).toEqual({ points: 5 });
    expect(patchSchemaOf(reportScheduleSchema).parse({ is_active: false })).toEqual({ is_active: false });
  });

  it("validasi per field tetap jalan", () => {
    expect(patchSchemaOf(scoringRuleSchema).safeParse({ points: 500 }).success).toBe(false);
  });

  it("field yang di-omit dibuang dari hasil", () => {
    const schema = patchSchemaOf(customFieldSchema, ["key", "object"]);
    expect(schema.parse({ key: "x", label: "Label" })).toEqual({ label: "Label" });
    expect(patchSchemaOf(publicFormSchema, ["slug"]).parse({ slug: "abc", name: "Form" })).toEqual({ name: "Form" });
  });
});
