import { describe, expect, it } from "vitest";
import {
  EMPTY_JOB_FORM,
  countJobsByStatus,
  jobToForm,
  slugify,
  toJobPayload,
  withDepartment,
  withPosition,
  withTitle,
  type JobOpening,
} from "./job-portal-form";

const positions = [
  { id: "p1", title: "Head Barista", department: "operations", level: null },
  { id: "p2", title: "Akuntan", department: null, level: null },
];
const departments = [
  { id: "d1", name: "Operations", code: "OPS", is_active: true },
  { id: "d2", name: "Finance", code: "FIN", is_active: true },
];

describe("slugify", () => {
  it("huruf kecil, tanda baca jadi strip, strip di tepi dibuang", () => {
    expect(slugify("  Head Barista (Jakarta)! ")).toBe("head-barista-jakarta");
    expect(slugify("  Kitchen & Bar (Shift Malam) ")).toBe("kitchen-bar-shift-malam");
  });
});

describe("withTitle", () => {
  it("mengisi slug hanya bila masih kosong", () => {
    expect(withTitle(EMPTY_JOB_FORM, "Kasir Pagi").slug).toBe("kasir-pagi");
    expect(withTitle({ ...EMPTY_JOB_FORM, slug: "tetap" }, "Kasir Pagi").slug).toBe("tetap");
  });
});

describe("withPosition", () => {
  it("mengisi judul, slug, dan department yang cocok", () => {
    expect(withPosition(EMPTY_JOB_FORM, "p1", positions, departments)).toMatchObject({
      position_id: "p1",
      title: "Head Barista",
      slug: "head-barista",
      department_id: "d1",
      department: "Operations",
    });
  });

  it("tidak menimpa judul yang sudah diisi; department tetap bila tak cocok", () => {
    const form = { ...EMPTY_JOB_FORM, title: "Akuntan Senior", department_id: "d2", department: "Finance" };
    expect(withPosition(form, "p2", positions, departments)).toMatchObject({
      title: "Akuntan Senior",
      department_id: "d2",
      department: "Finance",
    });
  });
});

describe("withDepartment", () => {
  it("menyalin nama department, kosong bila tidak ada", () => {
    expect(withDepartment(EMPTY_JOB_FORM, "d2", departments).department).toBe("Finance");
    expect(withDepartment(EMPTY_JOB_FORM, "", departments).department).toBe("");
  });
});

describe("toJobPayload", () => {
  it("string kosong jadi null dan slug jatuh ke judul", () => {
    const { id, payload } = toJobPayload({ ...EMPTY_JOB_FORM, title: "Barista Shift Malam" });
    expect(id).toBeUndefined();
    expect(payload).toMatchObject({
      slug: "barista-shift-malam",
      position_id: null,
      brand_id: null,
      department_id: null,
      closing_date: null,
    });
    expect(payload).not.toHaveProperty("id");
  });

  it("round trip dari lowongan yang ada", () => {
    const job: JobOpening = {
      id: "j1",
      position_id: "p1",
      brand_id: null,
      department_id: "d1",
      title: "Head Barista",
      slug: "head-barista",
      department: "Operations",
      location: "Bandung",
      employment_type: "Full-time",
      work_mode: "On-site",
      headcount: 2,
      description: null,
      requirements: "Pengalaman 2 tahun",
      benefits: null,
      status: "published",
      closing_date: "2026-11-30",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };
    const { id, payload } = toJobPayload(jobToForm(job));
    expect(id).toBe("j1");
    expect(payload).toMatchObject({
      brand_id: null,
      description: "",
      requirements: "Pengalaman 2 tahun",
      closing_date: "2026-11-30",
      headcount: 2,
    });
  });
});

describe("countJobsByStatus", () => {
  it("menghitung per status", () => {
    expect(
      countJobsByStatus([{ status: "draft" }, { status: "published" }, { status: "published" }])
    ).toEqual({ draft: 1, published: 2, closed: 0 });
  });
});
