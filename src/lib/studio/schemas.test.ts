import { describe, expect, it } from "vitest";
import { coachCreateSchema, coachPatchSchema, programCreateSchema, programPatchSchema, templateCreateSchema } from "./schemas";

describe("skema Studio", () => {
  it("mengisi default saat create", () => {
    expect(coachCreateSchema.parse({ full_name: "Raka" })).toMatchObject({
      level: "coach",
      specialties: [],
      is_public: true,
      is_active: true,
    });
    expect(programCreateSchema.parse({ code: "hyx", name: "Hyrox Class" })).toMatchObject({
      code: "HYX",
      kind: "class",
      duration_minutes: 60,
    });
  });

  it("PATCH sebagian tidak menyisipkan default (zod 4 partial+default)", () => {
    expect(coachPatchSchema.parse({ full_name: "Raka" })).toEqual({ full_name: "Raka" });
    expect(programPatchSchema.parse({ name: "Strength" })).toEqual({ name: "Strength" });
  });

  it("menolak format jam yang salah dan email tidak valid", () => {
    expect(() =>
      templateCreateSchema.parse({ weekday: 1, start_time: "6:00", end_time: "07:00", program_id: crypto.randomUUID() })
    ).toThrow();
    expect(() => coachCreateSchema.parse({ full_name: "A", email: "bukan-email" })).toThrow();
    expect(coachCreateSchema.parse({ full_name: "A", email: "" }).email).toBeNull();
  });
});
