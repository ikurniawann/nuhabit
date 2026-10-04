import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});

vi.mock("@/lib/api/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/scope")>();
  return {
    ...actual,
    getApiUserScope: vi.fn(async () => ({
      userId: "user-1",
      role: "admin",
      businessScope: "company",
      holdingId: null,
      companyId: "company-1",
      branchId: null,
      isUnscoped: false,
    })),
  };
});

const createJournalEntryRecord = vi.fn();
const listJournalEntries = vi.fn();
vi.mock("@/lib/accounting/journal-entry-store", () => ({
  createJournalEntryRecord: (...args: unknown[]) => createJournalEntryRecord(...args),
  listJournalEntries: (...args: unknown[]) => listJournalEntries(...args),
}));

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const validBody = {
  entry_date: "2026-10-01",
  description: "Setoran modal",
  lines: [
    { account_id: ACCOUNT_A, entry_side: "DEBIT", amount: 1000 },
    { account_id: ACCOUNT_B, entry_side: "CREDIT", amount: 1000 },
  ],
};

function postRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function getRequest(query = ""): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/accounting/journal-entries${query}`) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefix.mockResolvedValue({ id: "user-1", full_name: "Admin" });
});

describe("/api/accounting/journal-entries", () => {
  it("meneruskan 403 dari guard IAM", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden("Akses ditolak"));
    const { GET } = await import("./route");
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Akses ditolak" });
  });

  it("GET memfilter per company user", async () => {
    listJournalEntries.mockResolvedValue([{ id: "je-1" }]);
    const { GET } = await import("./route");
    const res = await GET(getRequest("?status=DRAFT&search=%20modal%20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: "je-1" }] });
    expect(listJournalEntries).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DRAFT", search: "modal", companyScopeOr: "company_id.eq.company-1" })
    );
  });

  it("POST menolak body tidak valid dengan 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(postRequest({ ...validBody, lines: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(createJournalEntryRecord).not.toHaveBeenCalled();
  });

  it("POST draft → 201 dengan pesan draft", async () => {
    createJournalEntryRecord.mockResolvedValue({ id: "je-1" });
    const { POST } = await import("./route");
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "je-1" }, message: "Journal entry draft berhasil disimpan" });
    expect(createJournalEntryRecord).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "company-1", is_recon: false, post: false })
    );
  });

  it("pesan ApiError dari store sampai ke klien", async () => {
    createJournalEntryRecord.mockRejectedValue(ApiError.badRequest("Jurnal tidak balance: Debit 1000 ≠ Credit 900"));
    const { POST } = await import("./route");
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Jurnal tidak balance: Debit 1000 ≠ Credit 900",
    });
  });

  it("galat tak terduga → 500 tanpa membocorkan pesan internal", async () => {
    createJournalEntryRecord.mockRejectedValue(new Error("connection reset"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./route");
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Terjadi kesalahan server");
    spy.mockRestore();
  });
});
