// POST /api/crm/campaigns: aturan promo/template/jadwal dicek sebelum venue &
// insert; GET 400 bila venue belum dikonfigurasi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn(() => ({})) }));

const venue = vi.hoisted(() => ({ getCrmDefaultVenue: vi.fn() }));
vi.mock("@/lib/crm/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/server")>()),
  getCrmDefaultVenue: venue.getCrmDefaultVenue,
}));

const guards = vi.hoisted(() => ({ requireCrmUser: vi.fn() }));
vi.mock("@/lib/crm/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/guards")>()),
  requireCrmUser: guards.requireCrmUser,
}));

import { GET, POST } from "./route";

const BASE = { name: "Promo Oktober", message_template: "Halo {nama}, ada promo baru!", segment: {} };
const PROMO = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function post(body: unknown) {
  return new Request("http://localhost/api/crm/campaigns", { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  guards.requireCrmUser.mockResolvedValue({ id: "u1", role: "marketing" });
  venue.getCrmDefaultVenue.mockResolvedValue({ companyId: "co-1", branchId: "br-1" });
  db.query.mockResolvedValue([{ id: "camp-1" }]);
});

describe("POST /api/crm/campaigns", () => {
  it("mode batch tanpa prefix ditolak sebelum insert", async () => {
    const res = await POST(post({ ...BASE, promo_campaign_id: PROMO, promo_mode: "batch" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Mode voucher batch wajib mengisi prefix kode" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("template {kode} tanpa promo ditolak", async () => {
    const res = await POST(post({ ...BASE, message_template: "Pakai kode {kode} ya kak" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Template memuat {kode} tapi kampanye tidak melampirkan promo");
  });

  it("venue belum diset → 400", async () => {
    venue.getCrmDefaultVenue.mockResolvedValue({ companyId: null, branchId: "br-1" });
    const res = await POST(post(BASE));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Venue belum dikonfigurasi");
  });

  it("draft dibuat dengan venue default", async () => {
    const res = await POST(post(BASE));
    expect(await res.json()).toEqual({ success: true, data: { id: "camp-1" }, message: "Kampanye dibuat (draft)" });
    const [, values] = db.query.mock.calls[0];
    expect((values as unknown[]).slice(0, 3)).toEqual(["co-1", "br-1", "Promo Oktober"]);
    expect((values as unknown[]).at(-1)).toBe("draft");
  });
});

describe("GET /api/crm/campaigns", () => {
  it("400 bila branch venue belum diset", async () => {
    venue.getCrmDefaultVenue.mockResolvedValue({ companyId: "co-1", branchId: null });
    const res = await GET();
    expect(res.status).toBe(400);
  });
});
