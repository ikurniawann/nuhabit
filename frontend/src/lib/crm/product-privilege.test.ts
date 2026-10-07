import { describe, expect, it } from "vitest";
import { checkProductPrivileges } from "@/lib/crm/product-privilege";

/** Stub client: products & customer di-inject per kasus. */
function stubDb(input: {
  products: { id: string; name: string; min_xp: number | null }[];
  customer?: { id: string; total_xp: number } | null;
}) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in: async () => ({
              data: table === "pos_products" ? input.products : [],
              error: null,
            }),
            eq: () => ({
              maybeSingle: async () => ({
                data: table === "pos_customers" ? (input.customer ?? null) : null,
                error: null,
              }),
            }),
          };
        },
      };
    },
  };
}

describe("checkProductPrivileges", () => {
  it("tanpa item / tanpa produk privilege → allowed", async () => {
    expect(
      (await checkProductPrivileges(stubDb({ products: [] }), [], null)).allowed
    ).toBe(true);
    const db = stubDb({
      products: [{ id: "p1", name: "Kopi", min_xp: null }],
    });
    expect((await checkProductPrivileges(db, ["p1"], null)).allowed).toBe(true);
  });

  it("produk privilege tanpa member → ditolak dgn pesan pilih member", async () => {
    const db = stubDb({
      products: [{ id: "p1", name: "Signature Dish", min_xp: 500 }],
    });
    const result = await checkProductPrivileges(db, ["p1"], null);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("pilih member");
  });

  it("XP member cukup → allowed", async () => {
    const db = stubDb({
      products: [{ id: "p1", name: "Signature Dish", min_xp: 500 }],
      customer: { id: "c1", total_xp: 750 },
    });
    expect((await checkProductPrivileges(db, ["p1"], "c1")).allowed).toBe(true);
  });

  it("XP kurang → ditolak menyebut produk, syarat, dan XP saat ini", async () => {
    const db = stubDb({
      products: [
        { id: "p1", name: "Signature Dish", min_xp: 500 },
        { id: "p2", name: "Kopi", min_xp: null },
      ],
      customer: { id: "c1", total_xp: 100 },
    });
    const result = await checkProductPrivileges(db, ["p1", "p2"], "c1");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("Signature Dish");
    expect(result.message).toContain("500");
    expect(result.message).toContain("100");
  });

  it("min_xp 0 dianggap produk umum", async () => {
    const db = stubDb({
      products: [{ id: "p1", name: "Teh", min_xp: 0 }],
    });
    expect((await checkProductPrivileges(db, ["p1"], null)).allowed).toBe(true);
  });
});
