// Registry gelang — GET/POST /api/ticketing/bands lewat apiHandler: guard
// IAM + venue, validasi body, normalisasi UID, 409 duplikat, 201 sukses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (menus: readonly string[]) => requireIamMenuPrefix(menus),
}));
vi.mock("@/lib/api/scope", () => ({
  getApiUserScope: vi.fn(async () => ({ businessScope: "branch" })),
  importBusinessIds: vi.fn(() => ({ companyId: "company-1", branchId: "branch-1" })),
}));

const query = vi.fn();
const queryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  withTransaction: vi.fn(),
}));

const { GET, POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ticketing/bands", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefix.mockResolvedValue({ id: "user-1", role: "super_admin" });
});

describe("POST /api/ticketing/bands", () => {
  it("401 tanpa sesi, tanpa menyentuh DB", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.unauthorized());
    const res = await post({ nfc_uid: "04:A1:B2:C3" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Authentication required" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("menu admin ticketing yang diminta", async () => {
    await post({ nfc_uid: "04:A1:B2:C3:D4" });
    expect(requireIamMenuPrefix.mock.calls[0][0]).toContain("ticketing.settings");
  });

  it("400 validasi body", async () => {
    const res = await post({ nfc_uid: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("400 UID terlalu pendek setelah normalisasi", async () => {
    const res = await post({ nfc_uid: "04:A1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("UID gelang tidak valid — scan ulang kartu/gelang");
  });

  it("409 gelang sudah terdaftar", async () => {
    queryOne.mockResolvedValueOnce({ id: "band-1", status: "dipakai" });
    const res = await post({ nfc_uid: "04a1b2c3d4" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Gelang sudah terdaftar (status: dipakai)");
  });

  it("201 + UID dinormalisasi hex uppercase di venue user", async () => {
    const row = { id: "band-2", nfc_uid: "04A1B2C3D4", label: "Biru", status: "tersedia" };
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    const res = await post({ nfc_uid: "04:a1:b2:c3:d4", label: "Biru" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: row, message: "Gelang terdaftar" });
    expect(queryOne.mock.calls[1][1]).toEqual(["company-1", "branch-1", "04A1B2C3D4", "Biru", "user-1"]);
  });
});

describe("GET /api/ticketing/bands", () => {
  it("paginasi dari COUNT(*) OVER() tanpa membocorkan total_count", async () => {
    query.mockResolvedValueOnce([
      { id: "b1", nfc_uid: "AA", total_count: "45" },
      { id: "b2", nfc_uid: "BB", total_count: "45" },
    ]);
    const res = await GET(
      new NextRequest("http://localhost/api/ticketing/bands?page=2&limit=20&status=hilang&q=aa")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: [
        { id: "b1", nfc_uid: "AA" },
        { id: "b2", nfc_uid: "BB" },
      ],
      pagination: { page: 2, limit: 20, total: 45, totalPages: 3 },
    });
    expect(query.mock.calls[0][1]).toEqual(["branch-1", "company-1", "hilang", "%aa%", 20, 20]);
  });

  it("500 generik bila query gagal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error("koneksi putus"));
    const res = await GET(new NextRequest("http://localhost/api/ticketing/bands"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Terjadi kesalahan server" });
  });
});
