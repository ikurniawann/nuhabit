import { describe, expect, it } from "vitest";
import { employeeDocumentPatchSchema } from "@/lib/hris/employee-document-schema";

describe("employeeDocumentPatchSchema — allowlist field", () => {
  it("membuang field sensitif yang tidak diizinkan (is_verified, employee_id, dst)", () => {
    const parsed = employeeDocumentPatchSchema.parse({
      document_name: "KTP baru",
      is_verified: true,
      verified_by: "penyerang",
      employee_id: "korban",
      uploaded_by: "x",
    });
    expect(parsed).toEqual({ document_name: "KTP baru" });
    expect("is_verified" in parsed).toBe(false);
    expect("employee_id" in parsed).toBe(false);
  });
  it("menerima field metadata yang sah", () => {
    const parsed = employeeDocumentPatchSchema.parse({ document_type: "KTP", notes: "catatan" });
    expect(parsed).toEqual({ document_type: "KTP", notes: "catatan" });
  });
  it("menolak tipe salah", () => {
    expect(employeeDocumentPatchSchema.safeParse({ document_name: 123 }).success).toBe(false);
  });
});
