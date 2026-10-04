import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { OfferCapReachedError, recordOfferUsage } from "./offer-rules-server";
import type { AppliedOffer } from "./offer-evaluate";

type Caps = {
  max_uses: number | null;
  max_uses_per_member: number | null;
  used_count: number;
  member_used_count: number;
};

/** Klien palsu: mencatat SQL, menjawab baca kuota dari peta per aturan. */
function fakeClient(capsByRule: Record<string, Caps>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes("FROM promo.offer_rules r WHERE r.id")) {
      return { rows: [capsByRule[String(params[0])]], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  return Object.assign({ query } as unknown as Pick<PoolClient, "query">, { calls });
}

const applied = (ruleId: string): AppliedOffer => ({
  rule_id: ruleId,
  offer_type: "volume",
  name: `Promo ${ruleId}`,
  discount: 5_000,
});

const base = {
  companyId: "co",
  branchId: "br",
  orderId: "order-1",
  customerId: "member-1",
  status: "held" as const,
  enforce: true,
};

describe("recordOfferUsage", () => {
  it("mengunci tiap aturan, cek kuota, lalu mencatat held", async () => {
    const client = fakeClient({
      r1: { max_uses: 10, max_uses_per_member: 1, used_count: 3, member_used_count: 0 },
    });
    await recordOfferUsage(client, { ...base, applied: [applied("r1")] });
    expect(client.calls[0]!.sql).toContain("pg_advisory_xact_lock");
    const insert = client.calls.find((c) => c.sql.includes("INSERT INTO promo.offer_usages"));
    expect(insert?.params).toEqual(["co", "br", "r1", "order-1", "member-1", 5_000, "held"]);
  });

  it("kuota total habis → OfferCapReachedError, tidak ada insert", async () => {
    const client = fakeClient({
      r1: { max_uses: 3, max_uses_per_member: null, used_count: 3, member_used_count: 0 },
    });
    await expect(
      recordOfferUsage(client, { ...base, applied: [applied("r1")] })
    ).rejects.toBeInstanceOf(OfferCapReachedError);
    expect(client.calls.some((c) => c.sql.includes("INSERT"))).toBe(false);
  });

  it("kuota per member habis → ditolak dgn nama penawaran", async () => {
    const client = fakeClient({
      r1: { max_uses: null, max_uses_per_member: 1, used_count: 50, member_used_count: 1 },
    });
    await expect(
      recordOfferUsage(client, { ...base, applied: [applied("r1")] })
    ).rejects.toThrow(/Promo r1/);
  });

  it("urutan kunci tetap (id terurut) supaya tidak deadlock", async () => {
    const free = { max_uses: null, max_uses_per_member: null, used_count: 0, member_used_count: 0 };
    const client = fakeClient({ a: free, b: free });
    await recordOfferUsage(client, { ...base, applied: [applied("b"), applied("a")] });
    const locked = client.calls
      .filter((c) => c.sql.includes("pg_advisory_xact_lock"))
      .map((c) => c.params[0]);
    expect(locked).toEqual(["a", "b"]);
  });

  it("tanpa enforce (open bill) hanya mencatat, tanpa kunci", async () => {
    const client = fakeClient({});
    await recordOfferUsage(client, {
      ...base,
      status: "captured",
      enforce: false,
      applied: [applied("r1")],
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.params.at(-1)).toBe("captured");
  });
});
