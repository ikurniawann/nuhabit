import { describe, expect, test } from "vitest";
import {
  allocateBundlePrice,
  bundleMembersPerUnit,
  expandBundleMembers,
  type BundleComponentDef,
} from "./bundle";

const komposisiKeluarga: BundleComponentDef[] = [
  {
    component_variant_id: "v-adult",
    qty: 2,
    product_name: "Tiket Masuk",
    variant_name: "Adult",
    weight_price: 50000,
  },
  {
    component_variant_id: "v-child",
    qty: 2,
    product_name: "Tiket Masuk",
    variant_name: "Child",
    weight_price: 25000,
  },
];

describe("bundleMembersPerUnit & expandBundleMembers", () => {
  test("menghitung jumlah orang per unit paket", () => {
    // Arrange + Act + Assert
    expect(bundleMembersPerUnit(komposisiKeluarga)).toBe(4);
    expect(bundleMembersPerUnit([])).toBe(0);
  });

  test("ekspansi mengikuti urutan komposisi dengan label & bobot", () => {
    // Act
    const members = expandBundleMembers(komposisiKeluarga);

    // Assert
    expect(members).toHaveLength(4);
    expect(members.map((m) => m.component_variant_id)).toEqual([
      "v-adult",
      "v-adult",
      "v-child",
      "v-child",
    ]);
    expect(members[0].member_label).toBe("Tiket Masuk — Adult");
    expect(members[3].member_label).toBe("Tiket Masuk — Child");
    expect(members[0].weight_price).toBe(50000);
    expect(members[3].weight_price).toBe(25000);
  });
});

describe("allocateBundlePrice", () => {
  test("prorata berbobot: jumlah alokasi TEPAT sama dengan harga paket", () => {
    // Arrange: paket 100rb utk 2 Adult (50rb) + 2 Child (25rb)
    const weights = [50000, 50000, 25000, 25000];

    // Act
    const shares = allocateBundlePrice(100000, weights);

    // Assert: Σ = 100000 persis (syarat net-0 redeem)
    expect(shares).toHaveLength(4);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100000);
    // Adult ≈ 2× Child; sisa pembulatan terserap di dalam kelompok Adult
    expect(shares[0] + shares[1]).toBeCloseTo(66666.67, 2);
    expect(shares[2] + shares[3]).toBeCloseTo(33333.33, 2);
  });

  test("pembagian rata bila bobot sama", () => {
    expect(allocateBundlePrice(100000, [1, 1, 1, 1])).toEqual([
      25000, 25000, 25000, 25000,
    ]);
  });

  test("bobot null / total nol → fallback pembagian rata", () => {
    // Arrange: satu komponen tanpa harga satuan
    const withNull = allocateBundlePrice(90000, [50000, null, 25000]);
    const allZero = allocateBundlePrice(90000, [0, 0, 0]);

    // Assert
    expect(withNull).toEqual([30000, 30000, 30000]);
    expect(allZero).toEqual([30000, 30000, 30000]);
  });

  test("harga paket 0 (comp/gratis) → semua anggota 0", () => {
    expect(allocateBundlePrice(0, [50000, 25000])).toEqual([0, 0]);
  });

  test("kasus pembulatan ekstrem: tak ada bagian negatif, Σ tetap tepat", () => {
    // Arrange: 0.05 dibagi 10 orang — pembulatan per-baris naif akan
    // menghasilkan baris terakhir negatif; kumulatif tidak
    const shares = allocateBundlePrice(0.05, Array(10).fill(1));

    // Assert
    expect(shares.every((s) => s >= 0)).toBe(true);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100).toBe(0.05);
  });

  test("daftar bobot kosong → alokasi kosong", () => {
    expect(allocateBundlePrice(100000, [])).toEqual([]);
  });
});
