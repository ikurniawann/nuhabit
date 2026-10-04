// Cek saldo gift card kasir: wajib sesi POS, format kode divalidasi sebelum DB.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
const preview = vi.fn();

vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/crm/server", () => ({ getCrmDefaultVenue: async () => ({ companyId: "co", branchId: "br" }) }));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/giftcard/giftcard-server", () => ({ previewGiftCardForPos: (...a: unknown[]) => preview(...a) }));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  session.userId = `kasir-${Math.random()}`;
  preview.mockReset();
});

describe("POST /api/pos/gift-card-check", () => {
  it("tanpa sesi POS → 401", async () => {
    session.userId = null;
    expect(await post({ code: "GC-AAAA-BBBB", total: 1000 })).toMatchObject({ status: 401 });
  });

  it("body tidak valid → 400 tanpa menyentuh DB", async () => {
    expect((await post({ code: "x" })).status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });

  it("kode valid → pratinjau saldo di venue default", async () => {
    preview.mockResolvedValue({ ok: true, balance: 50000 });
    const res = await post({ code: " gcabcd1234 ", total: 30000 });
    expect(res).toMatchObject({ status: 200, json: { success: true, data: { ok: true } } });
    expect(preview).toHaveBeenCalledWith({ scope: { companyId: "co", branchId: "br" }, code: "GCABCD1234", total: 30000 });
  });

  it("format kode salah → 400", async () => {
    expect(await post({ code: "GC-12", total: 0 })).toMatchObject({
      status: 400,
      json: { error: "Format kode gift card tidak valid" },
    });
  });
});
