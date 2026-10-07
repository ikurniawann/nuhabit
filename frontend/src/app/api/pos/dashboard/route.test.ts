import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
const load = vi.fn(async () => ({ stats: { todayRevenue: 1 } }));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/pos/dashboard-server", () => ({ loadPosDashboard: (...a: unknown[]) => load(...(a as [])) }));

async function get(query: string) {
  const { GET } = await import("./route");
  const res = await GET({ nextUrl: new URL(`http://x/api/pos/dashboard?${query}`) } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  session.userId = "kasir-1";
  load.mockClear();
});

describe("GET /api/pos/dashboard", () => {
  it("tanpa sesi POS → 401", async () => {
    session.userId = null;
    expect((await get("period=today")).status).toBe(401);
  });

  it("custom tidak valid → 400 tanpa query DB", async () => {
    expect(await get("period=custom&date_from=2026-10-05&date_to=2026-10-01")).toMatchObject({ status: 400 });
    expect(load).not.toHaveBeenCalled();
  });

  it("custom valid → rentang WIB inklusif + periode pembanding", async () => {
    const res = await get("period=custom&date_from=2026-10-01&date_to=2026-10-02");
    expect(res).toMatchObject({ status: 200, json: { success: true, data: { stats: { todayRevenue: 1 } } } });
    const [period, range] = load.mock.calls[0] as unknown as [string, Record<string, Date>];
    expect(period).toBe("custom");
    expect(range.startDate.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(range.prevEnd.getTime()).toBe(range.startDate.getTime() - 1);
  });

  it("periode tak dikenal diperlakukan sebagai bulan berjalan", async () => {
    await get("period=year");
    expect((load.mock.calls[0] as unknown as [string])[0]).toBe("month");
  });
});
