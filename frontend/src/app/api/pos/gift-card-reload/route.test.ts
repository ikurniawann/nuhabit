// Reload gift card kasir: sesi POS, validasi body, penolakan lib diteruskan dengan status aslinya.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
const reload = vi.fn();

vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/crm/server", () => ({ getCrmDefaultVenue: async () => ({ companyId: "co", branchId: "br" }) }));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/giftcard/giftcard-server", () => ({ reloadGiftCard: (...a: unknown[]) => reload(...a) }));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const valid = { code: "gcabcd1234", amount: 50000, payment_method: "cash" };

beforeEach(() => {
  session.userId = `kasir-${Math.random()}`;
  reload.mockReset();
});

describe("POST /api/pos/gift-card-reload", () => {
  it("tanpa sesi → 401; body salah → 400", async () => {
    session.userId = null;
    expect((await post(valid)).status).toBe(401);
    session.userId = "kasir-x";
    expect((await post({ code: "gcabcd1234", amount: -1, payment_method: "cash" })).status).toBe(400);
    expect(reload).not.toHaveBeenCalled();
  });

  it("berhasil: kode huruf besar, kasir tercatat", async () => {
    reload.mockResolvedValue({ ok: true, balance_after: 150000 });
    const res = await post(valid);
    expect(res).toMatchObject({ status: 200, json: { success: true } });
    expect(reload).toHaveBeenCalledWith(
      expect.objectContaining({ card: { code: "GCABCD1234" }, amount: 50000, createdBy: session.userId })
    );
  });

  it("penolakan lib → status & alasan dari lib", async () => {
    reload.mockResolvedValue({ ok: false, status: 409, reason: "Kartu nonaktif" });
    expect(await post(valid)).toMatchObject({ status: 409, json: { success: false, error: "Kartu nonaktif" } });
  });
});
