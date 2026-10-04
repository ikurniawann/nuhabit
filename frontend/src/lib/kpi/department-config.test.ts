import { describe, expect, it } from "vitest";
import { departmentConfigSchema } from "./department-config";

const DEPT = "11111111-1111-4111-8111-111111111111";
const IND = "22222222-2222-4222-8222-222222222222";

const firstMessage = (data: unknown) => {
  const parsed = departmentConfigSchema.safeParse(data);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("departmentConfigSchema", () => {
  it("departemen & indikator wajib UUID", () => {
    expect(firstMessage({ department_id: "x", items: [] })).toBe("Departemen tidak valid");
    expect(firstMessage({ department_id: DEPT, items: [{ indicator_id: "x", enabled: true, weight: 10 }] })).toBe(
      "ID indikator tidak valid"
    );
  });

  it("bobot indikator aktif 1–100; nonaktif bebas", () => {
    expect(firstMessage({ department_id: DEPT, items: [{ indicator_id: IND, enabled: true, weight: 0 }] })).toBe(
      "Bobot indikator aktif harus 1–100"
    );
    expect(firstMessage({ department_id: DEPT, items: [{ indicator_id: IND, enabled: true, weight: "40" }] })).toBeNull();
  });

  it("minimal satu indikator aktif", () => {
    expect(firstMessage({ department_id: DEPT, items: [{ indicator_id: IND, enabled: false }] })).toBe(
      "Minimal satu indikator harus aktif untuk departemen ini"
    );
    expect(firstMessage({ department_id: DEPT })).toBe("Minimal satu indikator harus aktif untuk departemen ini");
  });
});
