import { describe, expect, test } from "vitest";
import {
  buildChannelBoard,
  buildLoketOptions,
  firstIncompleteVariant,
  planDateUnmark,
  type LoketBundleMemberRow,
  type LoketOptionRow,
} from "./distribution";

const variant = (id: string, regular: string | null, high: string | null) => ({
  id,
  name: `Varian ${id}`,
  price_regular: regular,
  price_high: high,
});

describe("firstIncompleteVariant", () => {
  test("harga lengkap di varian → null", () => {
    expect(firstIncompleteVariant([variant("a", "10000", "15000")], [])).toBeNull();
  });

  test("harga kurang tapi tertutup override kanal → null", () => {
    expect(
      firstIncompleteVariant(
        [variant("a", "10000", null)],
        [{ variant_id: "a", price_regular: null, price_high: "15000" }]
      )
    ).toBeNull();
  });

  test("varian pertama yang belum lengkap dikembalikan", () => {
    const result = firstIncompleteVariant(
      [variant("a", "10000", "15000"), variant("b", null, "1")],
      []
    );
    expect(result?.id).toBe("b");
  });
});

describe("buildChannelBoard", () => {
  test("distribusi, override, dan kelengkapan harga per kanal", () => {
    const board = buildChannelBoard({
      products: [
        { id: "p1", code: "TKT-0001", name: "Kolam", status: "active", product_kind: "single", thumbnail_url: null },
        { id: "p2", code: "TKT-0002", name: "Kosong", status: "draft", product_kind: "single", thumbnail_url: null },
      ],
      variants: [{ ...variant("v1", "10000", null), ticket_product_id: "p1" }],
      channels: [
        { id: "walk", code: "walk-in", name: "Walk-in", is_online: false },
        { id: "web", code: "website", name: "Website", is_online: true },
      ],
      distributions: [{ ticket_product_id: "p1", channel_id: "walk", is_distributed: true }],
      overrides: [{ variant_id: "v1", channel_id: "web", price_regular: null, price_high: "20000" }],
    });

    const [kolam, kosong] = board;
    expect(kolam.variants).toEqual([
      { id: "v1", name: "Varian v1", price_regular: 10000, price_high: null },
    ]);
    expect(kolam.channels.map((c) => [c.channel_code, c.is_distributed, c.price_complete])).toEqual([
      ["walk-in", true, false],
      ["website", false, true],
    ]);
    expect(kolam.channels[1].overrides).toEqual([
      { variant_id: "v1", price_regular: null, price_high: 20000 },
    ]);
    // Produk tanpa varian aktif tidak pernah dianggap lengkap
    expect(kosong.channels.every((c) => !c.price_complete)).toBe(true);
  });
});

describe("buildLoketOptions", () => {
  const row = (over: Partial<LoketOptionRow>): LoketOptionRow => ({
    variant_id: "v",
    variant_name: "Adult",
    ticket_product_id: "p",
    ticket_code: "TKT-0001",
    ticket_name: "Kolam",
    product_kind: "single",
    price_regular: "10000",
    price_high: "12000",
    ...over,
  });
  const member = (over: Partial<LoketBundleMemberRow>): LoketBundleMemberRow => ({
    bundle_product_id: "bundle",
    component_variant_id: "cv",
    qty: 2,
    product_name: "Kolam",
    variant_name: "Adult",
    component_status: "active",
    component_kind: "single",
    variant_is_active: true,
    ...over,
  });

  test("tiket satuan: harga numerik, tanpa anggota", () => {
    expect(buildLoketOptions([row({})], [])).toEqual([
      { ...row({}), price_regular: 10000, price_high: 12000, members: [], members_per_unit: 0 },
    ]);
  });

  test("paket layak: anggota + jumlah gelang per unit", () => {
    const [option] = buildLoketOptions(
      [row({ ticket_product_id: "bundle", product_kind: "bundle", price_high: null })],
      [member({}), member({ component_variant_id: "cv2", qty: 1, variant_name: "Child" })]
    );
    expect(option.members).toEqual([
      { component_variant_id: "cv", qty: 2, label: "Kolam — Adult" },
      { component_variant_id: "cv2", qty: 1, label: "Kolam — Child" },
    ]);
    expect(option.members_per_unit).toBe(3);
    expect(option.price_high).toBeNull();
  });

  test("paket kosong atau berkomponen nonaktif disembunyikan", () => {
    const bundle = row({ ticket_product_id: "bundle", product_kind: "bundle" });
    expect(buildLoketOptions([bundle], [])).toEqual([]);
    expect(buildLoketOptions([bundle], [member({ variant_is_active: false })])).toEqual([]);
    expect(buildLoketOptions([bundle], [member({ component_status: "draft" })])).toEqual([]);
  });
});

describe("planDateUnmark", () => {
  test("baris sehari dihapus", () => {
    expect(planDateUnmark({ start_date: "2026-10-04", end_date: "2026-10-04" }, "2026-10-04")).toEqual({
      kind: "delete",
    });
  });

  test("tepi rentang digeser", () => {
    const range = { start_date: "2026-10-01", end_date: "2026-10-05" };
    expect(planDateUnmark(range, "2026-10-01")).toEqual({ kind: "set-start", start: "2026-10-02" });
    expect(planDateUnmark(range, "2026-10-05")).toEqual({ kind: "set-end", end: "2026-10-04" });
  });

  test("tanggal di tengah membelah rentang", () => {
    expect(planDateUnmark({ start_date: "2026-09-30", end_date: "2026-10-05" }, "2026-10-01")).toEqual({
      kind: "split",
      leftEnd: "2026-09-30",
      rightStart: "2026-10-02",
    });
  });
});
