// Cek kode kasir: kode pembuka penawaran menang atas campaign promo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const findOffer = vi.fn();
const previewPromo = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => `kasir-${Math.random()}`),
}));
vi.mock("@/lib/crm/server", () => ({ getCrmDefaultVenue: async () => ({ companyId: "co", branchId: "br" }) }));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/promo/offer-rules-server", () => ({ findOfferByUnlockCode: (...a: unknown[]) => findOffer(...a) }));
vi.mock("@/lib/promo/promo-server", () => ({ previewPromoCode: (...a: unknown[]) => previewPromo(...a) }));
vi.mock("@/lib/promo/offer-pos", () => ({ todayJakartaIso: () => "2026-10-04" }));
vi.mock("@/lib/promo/promo", () => ({ PROMO_REJECT_LABELS: { expired: "Promo sudah berakhir" } }));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  findOffer.mockReset();
  previewPromo.mockReset();
});

describe("POST /api/pos/promo-check", () => {
  it("body tidak valid → 400", async () => {
    expect((await post({ code: "AB" })).status).toBe(400);
  });

  it("kode pembuka penawaran → kind offer tanpa cek promo", async () => {
    findOffer.mockResolvedValue({ id: "r1", name: "Bundling" });
    expect(await post({ code: "BUKA", subtotal: 1000 })).toMatchObject({
      json: { data: { ok: true, kind: "offer", rule_id: "r1" } },
    });
    expect(findOffer).toHaveBeenCalledWith({ companyId: "co", branchId: "br", code: "BUKA", todayIsoDate: "2026-10-04" });
    expect(previewPromo).not.toHaveBeenCalled();
  });

  it("promo ditolak → label alasan", async () => {
    findOffer.mockResolvedValue(null);
    previewPromo.mockResolvedValue({ ok: false, reason: "expired" });
    expect(await post({ code: "HEMAT", subtotal: 1000 })).toMatchObject({
      json: { data: { ok: false, kind: "promo", label: "Promo sudah berakhir" } },
    });
  });
});
