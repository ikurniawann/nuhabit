import { describe, expect, it } from "vitest";
import {
  allowedSources,
  groupHitsBySource,
  isSearchable,
  likePattern,
  normalizeSearchQuery,
  rankSearchHits,
  type SearchHit,
} from "@/lib/desktop/search";
import { buildDeepLink, isSafeDashboardPath, parseDeepLink } from "@/lib/desktop/deep-link";

describe("normalisasi & pola pencarian", () => {
  it("merapikan spasi dan membatasi panjang", () => {
    expect(normalizeSearchQuery("  kopi   susu  ")).toBe("kopi susu");
    expect(normalizeSearchQuery("a".repeat(200))).toHaveLength(80);
    expect(normalizeSearchQuery(null)).toBe("");
  });
  it("kueri terlalu pendek tidak menembak database", () => {
    expect(isSearchable("k")).toBe(false);
    expect(isSearchable("ko")).toBe(true);
    expect(isSearchable("  ")).toBe(false);
  });
  it("wildcard dari pengguna di-escape, bukan diteruskan ke LIKE", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });
});

describe("allowedSources", () => {
  it("hanya sumber yang menunya dimiliki pengguna", () => {
    const keys = allowedSources(["crm.members.list", "pos.reports.dashboard"]).map((s) => s.key);
    expect(keys).toContain("member");
    expect(keys).toContain("order");
    expect(keys).not.toContain("employee");
    expect(keys).not.toContain("document");
  });
  it("prefiks harus cocok utuh — 'crm' tidak cocok ke 'crmx'", () => {
    expect(allowedSources(["crmx.members"]).map((s) => s.key)).not.toContain("member");
  });
  it("tanpa data IAM sama sekali → semua sumber (instalasi baru)", () => {
    expect(allowedSources([])).toHaveLength(6);
  });
});

describe("rankSearchHits", () => {
  const hit = (title: string): SearchHit => ({ source: "order", id: title, title, href: "/x" });
  it("cocok persis → awalan → mengandung", () => {
    const ranked = rankSearchHits([hit("XX POS-5"), hit("POS-5 lanjutan"), hit("POS-5")], "pos-5");
    expect(ranked.map((h) => h.title)).toEqual(["POS-5", "POS-5 lanjutan", "XX POS-5"]);
  });
});

describe("groupHitsBySource", () => {
  it("mengelompokkan sesuai urutan sumber & membuang grup kosong", () => {
    const groups = groupHitsBySource([
      { source: "member", id: "1", title: "Budi", href: "/a" },
      { source: "order", id: "2", title: "POS-1", href: "/b" },
    ]);
    expect(groups.map((g) => g.source)).toEqual(["order", "member"]);
  });
});

describe("deep link", () => {
  it("hanya menerima path dashboard internal", () => {
    expect(isSafeDashboardPath("/dashboard/pos/orders")).toBe(true);
    expect(isSafeDashboardPath("/dashboard")).toBe(true);
    expect(isSafeDashboardPath("https://evil.test/dashboard")).toBe(false);
    expect(isSafeDashboardPath("//evil.test")).toBe(false);
    expect(isSafeDashboardPath("/dashboardevil")).toBe(false);
    expect(isSafeDashboardPath(null)).toBe(false);
  });
  it("judul diturunkan dari path bila tidak diberikan", () => {
    const params = new URLSearchParams("open=%2Fdashboard%2Fpos%2Frush-hour");
    expect(parseDeepLink(params)).toEqual({ path: "/dashboard/pos/rush-hour", title: "Rush Hour" });
  });
  it("judul eksplisit dipakai; target berbahaya → null", () => {
    expect(parseDeepLink(new URLSearchParams("open=/dashboard/crm&title=CRM"))).toEqual({
      path: "/dashboard/crm",
      title: "CRM",
    });
    expect(parseDeepLink(new URLSearchParams("open=https://evil.test"))).toBeNull();
    expect(parseDeepLink(new URLSearchParams(""))).toBeNull();
  });
  it("buildDeepLink bolak-balik dengan parseDeepLink", () => {
    const url = buildDeepLink("/dashboard/pos/orders", "Transaksi");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(parseDeepLink(params)).toEqual({ path: "/dashboard/pos/orders", title: "Transaksi" });
  });
});
