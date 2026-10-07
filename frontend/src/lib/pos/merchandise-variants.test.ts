import { describe, expect, it } from "vitest";
import {
  blockedDeactivations,
  buildSkuCode,
  buildSkuName,
  composedBarcodeTooLong,
  diffMatrix,
  expandMatrix,
  MAX_AXES,
  MAX_COMBOS,
  MAX_VALUES_PER_AXIS,
  MatrixTooLargeError,
  validateMatrixSize,
  type ExistingSku,
  type VariantAxis,
} from "./merchandise-variants";

describe("expandMatrix", () => {
  it("cartesian product mempertahankan urutan sumbu & nilai", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M"] },
      { key: "warna", values: ["Hitam", "Putih"] },
    ];
    expect(expandMatrix(axes)).toEqual([
      { ukuran: "S", warna: "Hitam" },
      { ukuran: "S", warna: "Putih" },
      { ukuran: "M", warna: "Hitam" },
      { ukuran: "M", warna: "Putih" },
    ]);
  });

  it("4 ukuran x 2 warna = 8 kombinasi", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M", "L", "XL"] },
      { key: "warna", values: ["Hitam", "Putih"] },
    ];
    expect(expandMatrix(axes)).toHaveLength(8);
  });

  it("trim, buang nilai kosong & duplikat (case-insensitive)", () => {
    const axes: VariantAxis[] = [{ key: "ukuran", values: [" S ", "S", "s", "", "  ", "M"] }];
    expect(expandMatrix(axes)).toEqual([{ ukuran: "S" }, { ukuran: "M" }]);
  });

  it("sumbu tanpa key diabaikan", () => {
    const axes: VariantAxis[] = [{ key: "  ", values: ["X"] }, { key: "warna", values: ["Hitam"] }];
    expect(expandMatrix(axes)).toEqual([{ warna: "Hitam" }]);
  });

  it("sumbu manapun tanpa nilai valid → hasil kosong", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M"] },
      { key: "warna", values: ["  ", ""] },
    ];
    expect(expandMatrix(axes)).toEqual([]);
  });

  it("axes kosong → hasil kosong", () => {
    expect(expandMatrix([])).toEqual([]);
  });

  it("sumbu ketiga custom didukung", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["M"] },
      { key: "warna", values: ["Hitam"] },
      { key: "bahan", values: ["Katun", "Polyester"] },
    ];
    expect(expandMatrix(axes)).toEqual([
      { ukuran: "M", warna: "Hitam", bahan: "Katun" },
      { ukuran: "M", warna: "Hitam", bahan: "Polyester" },
    ]);
  });

  // EPIC-047 security fix (S1) — expandMatrix harus menolak (self-guard)
  // matriks raksasa SEBELUM alokasi apa pun, bukan setelah cartesian
  // product-nya dihitung. 5 sumbu x 40 nilai = 40^5 = 102.400.000 baris —
  // kalau guard tidak berjalan di awal, test ini akan OOM/timeout jauh di
  // atas 100ms.
  it("S1: 5 sumbu x 40 nilai (semua sumbu di dalam MAX_VALUES_PER_AXIS) — MatrixTooLargeError seketika, < 100ms, tanpa alokasi", () => {
    const axes: VariantAxis[] = Array.from({ length: 5 }, (_, axisIndex) => ({
      key: `sumbu${axisIndex}`,
      values: Array.from({ length: 40 }, (_, valueIndex) => `v${axisIndex}-${valueIndex}`),
    }));
    const start = Date.now();
    expect(() => expandMatrix(axes)).toThrow(MatrixTooLargeError);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe("buildSkuCode", () => {
  it("deterministik: base + values uppercase, non-alnum dibuang", () => {
    expect(buildSkuCode("KAOS-001", { ukuran: "M", warna: "Hitam" })).toBe("KAOS-001-M-HITAM");
  });

  it("urutan token ikut urutan key di options", () => {
    expect(buildSkuCode("KAOS-001", { warna: "Hitam", ukuran: "M" })).toBe("KAOS-001-HITAM-M");
  });

  it("selalu sama untuk options yang sama", () => {
    const a = buildSkuCode("APL-KAOS-001", { ukuran: "XL", warna: "Navy" });
    const b = buildSkuCode("APL-KAOS-001", { ukuran: "XL", warna: "Navy" });
    expect(a).toBe(b);
  });

  it("base kosong fallback ke SKU", () => {
    expect(buildSkuCode("", { ukuran: "M" })).toBe("SKU-M");
  });

  it("≤60 karakter — memendekkan token nilai, base tidak pernah dipotong", () => {
    const base = "KAOS-001";
    const options = {
      ukuran: "EXTRAEXTRAEXTRALARGEUKURANPANJANGSEKALI",
      warna: "HITAMKEABUABUANGELAPBANGETSEKALI",
    };
    const code = buildSkuCode(base, options);
    expect(code.length).toBeLessThanOrEqual(60);
    expect(code.startsWith(base)).toBe(true);
  });

  it("fallback ekstrem: base sendiri sudah >60 karakter — dipotong sebagai upaya terakhir", () => {
    const base = "KAOS-" + "X".repeat(60); // 65 karakter, sudah > MAX_SKU_LENGTH sendirian
    const code = buildSkuCode(base, { ukuran: "M", warna: "Hitam" });
    expect(code.length).toBeLessThanOrEqual(60);
    expect(code).toBe(base.slice(0, 60));
  });
});

describe("buildSkuName", () => {
  it("format Nama — Value1 / Value2", () => {
    expect(buildSkuName("Kaos Polos", { ukuran: "M", warna: "Hitam" })).toBe("Kaos Polos — M / Hitam");
  });

  it("tanpa options → nama saja", () => {
    expect(buildSkuName("Kaos Polos", {})).toBe("Kaos Polos");
  });
});

describe("diffMatrix", () => {
  const row = (over: Partial<ExistingSku>): ExistingSku => ({
    id: "id",
    sku: "SKU",
    name: "Name",
    options: {},
    stock_quantity: 0,
    is_active: true,
    ...over,
  });

  it("create untuk kombinasi baru, keep untuk yang cocok, deactivate untuk yang hilang", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S", warna: "Hitam" } }),
      row({ id: "2", options: { ukuran: "M", warna: "Hitam" } }),
    ];
    const wanted = [
      { ukuran: "M", warna: "Hitam" },
      { ukuran: "L", warna: "Hitam" },
    ];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([{ ukuran: "L", warna: "Hitam" }]);
    expect(result.keep.map((r) => r.id)).toEqual(["2"]);
    expect(result.deactivate.map((r) => r.id)).toEqual(["1"]);
  });

  it("matching order-insensitive terhadap urutan key", () => {
    const existing: ExistingSku[] = [row({ id: "1", options: { warna: "Hitam", ukuran: "M" } })];
    const wanted = [{ ukuran: "M", warna: "Hitam" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.keep.map((r) => r.id)).toEqual(["1"]);
    expect(result.deactivate).toEqual([]);
  });

  it("idempoten: matriks sama dua kali = no create/deactivate", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S" } }),
      row({ id: "2", options: { ukuran: "M" } }),
    ];
    const wanted = [{ ukuran: "S" }, { ukuran: "M" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.deactivate).toEqual([]);
    expect(result.keep).toHaveLength(2);
  });

  // F5 — varian yang di-drop lalu diminta lagi (mis. warna yang sempat
  // dihapus, dibawa balik musim depan) dihidupkan kembali, bukan di-insert
  // ulang (hindari tabrakan unique `sku` dengan baris lama yang non-aktif).
  it("F5: SKU non-aktif yang cocok options masuk reactivate, BUKAN create", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", sku: "APL-KAOS-001-M-MERAH", options: { ukuran: "M", warna: "Merah" }, is_active: false }),
    ];
    const wanted = [{ ukuran: "M", warna: "Merah" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.reactivate.map((r) => r.id)).toEqual(["1"]);
    expect(result.keep).toEqual([]);
    expect(result.deactivate).toEqual([]);
  });

  it("F5: matriks yang sama dikirim dua kali — hanya keep yang terisi (reactivate=create=deactivate kosong)", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "M", warna: "Hitam" }, is_active: true }),
    ];
    const wanted = [{ ukuran: "M", warna: "Hitam" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.reactivate).toEqual([]);
    expect(result.deactivate).toEqual([]);
    expect(result.keep.map((r) => r.id)).toEqual(["1"]);
  });

  it("F5: identitas options menang atas kode SKU — kode lama beda dari buildSkuCode saat ini tetap reactivate, bukan create baru", () => {
    // Simulasikan base SKU produk berubah sejak baris lama dibuat — kode
    // yang akan dihasilkan buildSkuCode() sekarang berbeda dari sku lama.
    const oldSkuCode = buildSkuCode("OLD-BASE", { ukuran: "L", warna: "Navy" });
    const currentSkuCode = buildSkuCode("APL-KAOS-001", { ukuran: "L", warna: "Navy" });
    expect(oldSkuCode).not.toBe(currentSkuCode);

    const existing: ExistingSku[] = [
      row({ id: "1", sku: oldSkuCode, options: { ukuran: "L", warna: "Navy" }, is_active: false }),
    ];
    const wanted = [{ ukuran: "L", warna: "Navy" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.reactivate.map((r) => r.id)).toEqual(["1"]);
  });

  it("F5: baris non-aktif yang TIDAK diinginkan lagi tidak masuk bucket manapun", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S", warna: "Merah" }, is_active: false }),
      row({ id: "2", options: { ukuran: "M", warna: "Hitam" }, is_active: true }),
    ];
    const wanted = [{ ukuran: "M", warna: "Hitam" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.reactivate).toEqual([]);
    expect(result.deactivate).toEqual([]);
    expect(result.keep.map((r) => r.id)).toEqual(["2"]);
  });

  // R1 — kalau ada baris aktif DAN baris non-aktif dengan options key yang
  // sama (tidak diharapkan terjadi dalam operasi normal, tapi data lama /
  // race yang tidak sempurna bisa membuatnya terjadi), baris aktif yang
  // harus dipakai (keep), baris non-aktif tidak boleh muncul di bucket
  // manapun (bukan reactivate, bukan create, bukan deactivate).
  it("R1: baris aktif & non-aktif berbagi options key yang sama — aktif menang (keep), non-aktif tidak masuk bucket manapun", () => {
    const existing: ExistingSku[] = [
      row({ id: "inactive-dupe", sku: "OLD-SKU", options: { ukuran: "M", warna: "Hitam" }, is_active: false }),
      row({ id: "active-winner", sku: "NEW-SKU", options: { ukuran: "M", warna: "Hitam" }, is_active: true }),
    ];
    const wanted = [{ ukuran: "M", warna: "Hitam" }];
    const result = diffMatrix(existing, wanted);
    expect(result.keep.map((r) => r.id)).toEqual(["active-winner"]);
    expect(result.create).toEqual([]);
    expect(result.reactivate).toEqual([]);
    expect(result.deactivate).toEqual([]);
  });

  it("diffMatrix tidak pernah mengusulkan deaktivasi SKU yang punya stok — dijaga blockedDeactivations", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S" }, stock_quantity: 5 }),
      row({ id: "2", options: { ukuran: "M" }, stock_quantity: 0 }),
    ];
    const wanted: Array<Record<string, string>> = [];
    const result = diffMatrix(existing, wanted);
    expect(result.deactivate.map((r) => r.id)).toEqual(["1", "2"]);
    const blocked = blockedDeactivations(existing, result.deactivate.map((r) => r.id));
    expect(blocked.map((r) => r.id)).toEqual(["1"]);
  });
});

describe("blockedDeactivations", () => {
  it("hanya baris dengan stock_quantity > 0 yang diblokir", () => {
    const existing: ExistingSku[] = [
      { id: "1", sku: "A", name: "A", options: {}, stock_quantity: 0, is_active: true },
      { id: "2", sku: "B", name: "B", options: {}, stock_quantity: 5, is_active: true },
    ];
    expect(blockedDeactivations(existing, ["1", "2"]).map((r) => r.id)).toEqual(["2"]);
  });

  it("id yang tidak masuk deactivateIds diabaikan", () => {
    const existing: ExistingSku[] = [{ id: "1", sku: "A", name: "A", options: {}, stock_quantity: 5, is_active: true }];
    expect(blockedDeactivations(existing, [])).toEqual([]);
  });
});

describe("validateMatrixSize", () => {
  const axisWithValues = (count: number, keyPrefix = "v") =>
    Array.from({ length: count }, (_, i) => `${keyPrefix}${i}`);

  it(`tepat ${MAX_AXES} sumbu — ok`, () => {
    const axes: VariantAxis[] = Array.from({ length: MAX_AXES }, (_, i) => ({
      key: `sumbu${i}`,
      values: ["A"],
    }));
    expect(validateMatrixSize(axes)).toEqual({ ok: true });
  });

  it(`${MAX_AXES + 1} sumbu — gagal "Maksimal 10 sumbu varian"`, () => {
    const axes: VariantAxis[] = Array.from({ length: MAX_AXES + 1 }, (_, i) => ({
      key: `sumbu${i}`,
      values: ["A"],
    }));
    expect(validateMatrixSize(axes)).toEqual({ ok: false, error: "Maksimal 10 sumbu varian" });
  });

  it(`tepat ${MAX_VALUES_PER_AXIS} nilai per sumbu — ok`, () => {
    const axes: VariantAxis[] = [{ key: "ukuran", values: axisWithValues(MAX_VALUES_PER_AXIS) }];
    expect(validateMatrixSize(axes)).toEqual({ ok: true });
  });

  it(`${MAX_VALUES_PER_AXIS + 1} nilai per sumbu — gagal "Maksimal 50 nilai per sumbu"`, () => {
    const axes: VariantAxis[] = [{ key: "ukuran", values: axisWithValues(MAX_VALUES_PER_AXIS + 1) }];
    expect(validateMatrixSize(axes)).toEqual({ ok: false, error: "Maksimal 50 nilai per sumbu" });
  });

  it(`tepat ${MAX_COMBOS} kombinasi (misal 25 x 20) — ok`, () => {
    const axes: VariantAxis[] = [
      { key: "a", values: axisWithValues(25, "a") },
      { key: "b", values: axisWithValues(20, "b") },
    ];
    expect(validateMatrixSize(axes)).toEqual({ ok: true });
  });

  it(`${MAX_COMBOS + 1} kombinasi (misal 25 x 21) — gagal "Maksimal 500 kombinasi..."`, () => {
    const axes: VariantAxis[] = [
      { key: "a", values: axisWithValues(25, "a") },
      { key: "b", values: axisWithValues(21, "b") },
    ];
    expect(validateMatrixSize(axes)).toEqual({
      ok: false,
      error: "Maksimal 500 kombinasi varian per produk",
    });
  });

  // EPIC-047 security fix (S1) — validateMatrixSize menghitung kombinasi
  // SECARA ARITMETIK (perkalian panjang sumbu), tidak pernah dengan
  // mengekspansi matriksnya — jadi hasil {ok:false} untuk matriks raksasa
  // harus datang seketika (< 100ms), bukan setelah mencoba
  // meng-cartesian-kan 102 juta baris.
  it("S1: 5 sumbu x 40 nilai — {ok:false} seketika (< 100ms), tanpa ekspansi", () => {
    const axes: VariantAxis[] = Array.from({ length: 5 }, (_, axisIndex) => ({
      key: `sumbu${axisIndex}`,
      values: Array.from({ length: 40 }, (_, valueIndex) => `v${axisIndex}-${valueIndex}`),
    }));
    const start = Date.now();
    const result = validateMatrixSize(axes);
    expect(Date.now() - start).toBeLessThan(100);
    expect(result.ok).toBe(false);
  });

  // EPIC-047 security fix (S3) — bentuk input yang tidak valid dari body
  // JSON tidak dipercaya (mis. `values` bukan array) harus ditolak dengan
  // pesan spesifik, bukan menabrak TypeError yang bocor jadi 500 di route.
  describe("S3: bentuk input tidak valid", () => {
    it("axis.values bukan array (angka) — ditolak, bukan crash", () => {
      const axes = [{ key: "ukuran", values: 123 }] as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Nilai sumbu harus berupa daftar",
      });
    });

    it("axis.values berupa objek — ditolak", () => {
      const axes = [{ key: "ukuran", values: { a: 1 } }] as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Nilai sumbu harus berupa daftar",
      });
    });

    it("axis.key bukan string (angka) — ditolak", () => {
      const axes = [{ key: 123, values: ["A"] }] as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Nilai sumbu harus berupa daftar",
      });
    });

    it("entri sumbu bukan objek (string) — ditolak", () => {
      const axes = ["ukuran"] as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Nilai sumbu harus berupa daftar",
      });
    });

    it("entri sumbu null — ditolak", () => {
      const axes = [null] as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Nilai sumbu harus berupa daftar",
      });
    });

    it("axes itu sendiri bukan array (string) — pesan berbeda: 'Sumbu varian harus berupa daftar'", () => {
      const axes = "x" as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Sumbu varian harus berupa daftar",
      });
    });

    it("axes undefined — pesan 'Sumbu varian harus berupa daftar'", () => {
      const axes = undefined as unknown as VariantAxis[];
      expect(validateMatrixSize(axes)).toEqual({
        ok: false,
        error: "Sumbu varian harus berupa daftar",
      });
    });

    it("expandMatrix juga tidak crash untuk axis.values non-array — hasil kosong, bukan TypeError", () => {
      const axes = [{ key: "ukuran", values: 123 }] as unknown as VariantAxis[];
      expect(() => expandMatrix(axes)).not.toThrow();
      expect(expandMatrix(axes)).toEqual([]);
    });
  });
});

describe("composedBarcodeTooLong", () => {
  it("prefix kosong — selalu false (tidak ada yang digabung)", () => {
    expect(composedBarcodeTooLong("", ["A".repeat(60)])).toBe(false);
  });

  it("prefix + sku tepat 64 karakter — false", () => {
    const prefix = "P".repeat(20);
    const sku = "S".repeat(44); // 20 + 44 = 64
    expect(composedBarcodeTooLong(prefix, [sku])).toBe(false);
  });

  it("prefix + sku 65 karakter — true", () => {
    const prefix = "P".repeat(20);
    const sku = "S".repeat(45); // 20 + 45 = 65
    expect(composedBarcodeTooLong(prefix, [sku])).toBe(true);
  });

  it("true kalau SALAH SATU kode SKU di daftar melebihi 64 walau yang lain aman", () => {
    const prefix = "P".repeat(20);
    const short = "S".repeat(10);
    const long = "S".repeat(45);
    expect(composedBarcodeTooLong(prefix, [short, long])).toBe(true);
  });

  it("daftar kosong — false", () => {
    expect(composedBarcodeTooLong("PREFIX", [])).toBe(false);
  });
});
