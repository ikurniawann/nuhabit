import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/table-order/server", () => ({
  loadTableByCode: async (code: string) => (code === "A1" ? { id: "t1", is_active: true, area: "Indoor" } : null),
  loadVenueContext: async () => ({
    brandName: "NüHabit",
    billingProfileName: "Default",
    charges: [],
    qrisAvailable: true,
    arkRate: 1000,
  }),
  tableLabel: (table: unknown, code: string) => (table ? "Meja A1" : `Meja ${code}`),
}));
vi.mock("@/lib/member-portal/session", () => ({ getMemberSession: async () => null }));
vi.mock("@/lib/crm/loyalty-features-server", () => ({ getLoyaltyFeatures: async () => ({ arkCoin: true, xp: false }) }));
vi.mock("@/lib/payments/static-qris", () => ({ loadStaticQris: async () => ({ available: false }) }));

const get = async (code: string) => {
  const { GET } = await import("./route");
  const res = await GET({} as NextRequest, { params: Promise.resolve({ tableCode: code }) });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
};

describe("GET /api/table-order/session/[tableCode]", () => {
  it("kode kosong → 400", async () => {
    expect(await get("%20")).toMatchObject({ status: 400, json: { error: "Kode meja wajib diisi" } });
  });

  it("meja terdaftar vs tidak: table_resolved & saklar loyalty", async () => {
    expect((await get("A1")).json.data).toMatchObject({ table_id: "t1", table_resolved: true, ark_enabled: true, xp_enabled: false });
    expect((await get("z9")).json.data).toMatchObject({ table_id: null, table_code: "Z9", table_resolved: false });
  });
});
