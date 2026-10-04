import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const load = vi.fn(async () => ({
  details: [
    {
      id: "o1",
      offer_type: "bundle",
      name: "Paket",
      description: null,
      valid_from: null,
      valid_until: null,
      bundle_price: "25000",
      buy_qty: null,
      get_qty: null,
      get_mode: null,
      volume_basis: null,
      volume_min: null,
      discount_type: null,
      discount_value: null,
      unlock_code: "RAHASIA",
      is_exclusive: false,
      items: [{ role: "buy", product_id: "p1", product_name: "Kopi", qty: "2" }],
    },
  ],
  rules: [{ id: "o1", kind: "eval" }],
}));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
}));
vi.mock("@/lib/crm/server", () => ({ getCrmDefaultVenue: async () => ({ companyId: "co", branchId: "br" }) }));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/promo/offer-pos", () => ({ loadActiveOfferEvalRules: (...a: unknown[]) => load(...(a as [])) }));

describe("GET /api/pos/offer-rules", () => {
  it("kode pembuka tidak bocor; customer_id non-UUID diabaikan", async () => {
    const { GET } = await import("./route");
    const res = await GET({ nextUrl: new URL("http://x/api/pos/offer-rules?customer_id=bukan-uuid") } as unknown as NextRequest);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data[0]).toMatchObject({ id: "o1", bundle_price: 25000, requires_code: true, eval: { id: "o1", kind: "eval" } });
    expect(JSON.stringify(json)).not.toContain("RAHASIA");
    expect(load).toHaveBeenCalledWith({ companyId: "co", branchId: "br", customerId: null });
  });
});
