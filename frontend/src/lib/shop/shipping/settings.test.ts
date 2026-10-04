import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn() }));

const { buildShippingSettingsPatch } = await import("./settings");

describe("buildShippingSettingsPatch", () => {
  it("hanya field yang dikirim; teks kosong jadi null, kurir dinormalisasi", () => {
    expect(
      buildShippingSettingsPatch({
        provider: "RajaOngkir",
        origin_label: "",
        origin_postal_code: 40115,
        couriers: " JNE, sicepat ,,",
        markup_amount: "2000",
      })
    ).toEqual({
      provider: "rajaongkir",
      origin_label: null,
      origin_postal_code: "40115",
      couriers: "jne,sicepat",
      markup_amount: 2000,
    });
  });

  it("menolak nilai tidak valid dengan pesan untuk admin", () => {
    expect(() => buildShippingSettingsPatch({ provider: "jne" })).toThrow("Provider harus biteship atau rajaongkir");
    expect(() => buildShippingSettingsPatch({ couriers: "," })).toThrow("Minimal satu kurir harus aktif");
    expect(() => buildShippingSettingsPatch({ markup_amount: -1 })).toThrow("Markup harus angka ≥ 0");
    expect(() => buildShippingSettingsPatch({})).toThrow("Tidak ada field yang diubah");
  });

  it("kurir kosong memakai daftar default", () => {
    expect(buildShippingSettingsPatch({ couriers: "" })).toEqual({ couriers: "jne,jnt,sicepat" });
  });
});
