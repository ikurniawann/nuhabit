import { describe, expect, it } from "vitest";
import { toSubmitFormData, type ApplicationFormValues } from "./application-schema";

const values: ApplicationFormValues = {
  full_name: "Budi",
  email: "budi@contoh.com",
  phone: "081234567890",
  domicile: "Bandung",
  source: "instagram",
  brand_id: "",
  notes: "Available for night shifts",
  expected_salary: "5000000",
};

describe("toSubmitFormData", () => {
  it("leaves out empty optional fields; includes the opening and the files", () => {
    const cv = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    const form = toSubmitFormData(values, { jobOpeningId: "op-1", cv, photo: null });
    expect(form.get("full_name")).toBe("Budi");
    expect(form.get("source")).toBe("instagram");
    expect(form.has("brand_id")).toBe(false);
    expect(form.get("notes")).toBe("Available for night shifts");
    expect(form.get("expected_salary")).toBe("5000000");
    expect(form.get("job_opening_id")).toBe("op-1");
    expect((form.get("cv") as File).name).toBe("cv.pdf");
    expect(form.has("photo")).toBe(false);
  });
});
