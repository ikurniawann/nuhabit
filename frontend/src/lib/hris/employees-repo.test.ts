import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn() }));

const {
  employeeCreateSchema,
  employeeUniqueMessage,
  employmentHistoryChange,
  nextAutoNip,
  parseDirectoryParams,
} = await import("./employees-repo");

describe("nextAutoNip", () => {
  it("nomor urut terkecil yang belum dipakai", () => {
    expect(nextAutoNip(2026, [])).toBe("EMP-2026-00001");
    expect(nextAutoNip(2026, ["EMP-2026-00001", "EMP-2026-00002", "EMP-2026-00004"])).toBe("EMP-2026-00003");
  });
});

describe("parseDirectoryParams", () => {
  it("membuang karakter pemecah filter dan membatasi limit", () => {
    const params = parseDirectoryParams(
      new URLSearchParams("search=budi,(x)&limit=9999&page=0&sort_by=bank_account&sort_order=desc&is_active=false")
    );
    expect(params.search).toBe("budi  x");
    expect(params.limit).toBe(500);
    expect(params.page).toBe(1);
    expect(params.sortBy).toBe("full_name");
    expect(params.ascending).toBe(false);
    expect(params.isActive).toBe(false);
  });
  it("is_active tidak dikirim → tanpa filter", () => {
    expect(parseDirectoryParams(new URLSearchParams()).isActive).toBeNull();
  });
});

describe("employmentHistoryChange", () => {
  const current = {
    employment_status: "probation",
    department_id: "d1",
    section_id: "s1",
    job_title_id: "j1",
  };

  it("PUT parsial tanpa field terlacak → tidak ada riwayat", () => {
    expect(employmentHistoryChange(current, { full_name: "Budi" })).toBeNull();
  });

  it("mencatat status & departemen yang berubah", () => {
    const change = employmentHistoryChange(current, { employment_status: "permanent", department_id: "d2" });
    expect(change?.notes).toBe("Status: probation → permanent, Departemen berubah");
    expect(change?.new_department_id).toBe("d2");
    expect(change?.new_section_id).toBe("s1");
  });
});

describe("employeeCreateSchema", () => {
  it("tidak menerima is_active/end_date dari body", () => {
    const parsed = employeeCreateSchema.parse({
      full_name: "Budi",
      email: "budi@contoh.test",
      join_date: "2026-01-01",
      employment_status: "probation",
      is_active: false,
      end_date: "2026-02-01",
    });
    expect("is_active" in parsed).toBe(false);
    expect("end_date" in parsed).toBe(false);
  });
});

describe("employeeUniqueMessage", () => {
  it("memetakan constraint ke pesan ramah", () => {
    expect(employeeUniqueMessage("employees_email_key")).toBe("Email sudah terdaftar");
    expect(employeeUniqueMessage("employees_ktp_key")).toBe("NIK/KTP sudah terdaftar");
    expect(employeeUniqueMessage("lainnya")).toBeNull();
  });
});
