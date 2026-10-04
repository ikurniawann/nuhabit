import { describe, expect, test } from "vitest";
import { BOOKING_MAX_QTY } from "./booking";
import { priceBookingCart, type CheckoutCatalogProduct } from "./booking-checkout";

const catalog: CheckoutCatalogProduct[] = [
  {
    ticket_product_id: "kolam",
    name: "Kolam",
    product_kind: "single",
    variants: [
      { variant_id: "adult", variant_name: "Adult", price: 25000.333, season_kind: "regular" },
      { variant_id: "child", variant_name: "Child", price: 15000, season_kind: "regular" },
    ],
  },
  {
    ticket_product_id: "paket",
    name: "Paket Keluarga",
    product_kind: "bundle",
    variants: [
      {
        variant_id: "paket-v",
        variant_name: "Paket",
        price: 60000,
        season_kind: "regular",
        members: [
          { component_variant_id: "adult", member_label: "Kolam — Adult", weight_price: 25000 },
          { component_variant_id: "adult", member_label: "Kolam — Adult", weight_price: 25000 },
          { component_variant_id: "child", member_label: "Kolam — Child", weight_price: 15000 },
        ],
      },
      { variant_id: "paket-kosong", variant_name: "Kosong", price: 1, season_kind: "regular", members: [] },
    ],
  },
];

describe("priceBookingCart", () => {
  test("harga dari katalog server, subtotal 2dp, total GROSS", () => {
    const cart = priceBookingCart(catalog, [{ variant_id: "adult", qty: 3 }], "Budi");
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    expect(cart.items[0]).toMatchObject({
      product_id: "kolam",
      product_name: "Kolam",
      variant_name: "Adult",
      price: 25000.333,
      persons_per_unit: 1,
      subtotal: 75001,
    });
    expect(cart.total).toBe(75001);
    expect(cart.totalQty).toBe(3);
  });

  test("paket dihitung per orang; nama default posisi-global", () => {
    const cart = priceBookingCart(
      catalog,
      [
        { variant_id: "child", qty: 1, guest_names: ["Ani"] },
        { variant_id: "paket-v", qty: 1, guest_names: [null, "Cici"] },
      ],
      "Budi"
    );
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    expect(cart.totalQty).toBe(4);
    expect(cart.items[1].persons_per_unit).toBe(3);
    expect(cart.guestNames).toEqual(["Ani", "Group Budi - 2", "Cici", "Group Budi - 4"]);
    expect(cart.total).toBe(75000);
  });

  test("varian tak dikenal / paket tanpa anggota ditolak", () => {
    expect(priceBookingCart(catalog, [{ variant_id: "x", qty: 1 }], "Budi")).toEqual({
      ok: false,
      error: "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman",
    });
    expect(priceBookingCart(catalog, [{ variant_id: "paket-kosong", qty: 1 }], "Budi")).toEqual({
      ok: false,
      error: "Ada paket yang tidak tersedia untuk tanggal ini — muat ulang halaman",
    });
  });

  test("batas orang per booking dan jumlah nama", () => {
    const tooMany = priceBookingCart(
      catalog,
      [{ variant_id: "paket-v", qty: Math.ceil(BOOKING_MAX_QTY / 3) + 1 }],
      "Budi"
    );
    expect(tooMany).toEqual({ ok: false, error: `Maksimum ${BOOKING_MAX_QTY} tiket per booking` });

    expect(
      priceBookingCart(catalog, [{ variant_id: "adult", qty: 1, guest_names: ["A", "B"] }], "Budi")
    ).toEqual({ ok: false, error: "Jumlah nama anggota melebihi jumlah tiket" });
  });
});
