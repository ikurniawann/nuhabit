import { describe, expect, test } from "vitest";
import {
  computeBalanceAfterCorrection,
  computeBalanceAfterIssue,
  DEFAULT_GIFT_CARD_CONFIG,
  evaluateGiftCardRedeem,
  generateGiftCardCode,
  isAllowedGiftCardNominal,
  isGiftCardExpired,
  isValidGiftCardCodeFormat,
  parseGiftCardConfig,
  type GiftCardConfig,
  resolveGiftCardExpiry,
  resolveStatusAfterRefund,
  type GiftCardState,
} from "./giftcard";

const card = (patch: Partial<GiftCardState> = {}): GiftCardState => ({
  status: "active",
  balance: 100_000,
  expiresAt: null,
  ...patch,
});

describe("generateGiftCardCode", () => {
  test("menghasilkan 12 karakter dari charset anti-ambigu", () => {
    const code = generateGiftCardCode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[A-Z0-9]+$/);
    expect(code).not.toMatch(/[0O1I]/);
  });

  test("praktis unik antar pemanggilan (CSPRNG, bukan Math.random)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateGiftCardCode()));
    expect(codes.size).toBe(200);
  });
});

describe("isValidGiftCardCodeFormat", () => {
  test("menerima kode 8-20 karakter alfanumerik kapital", () => {
    expect(isValidGiftCardCodeFormat("ABCD2345EFGH")).toBe(true);
  });

  test("menolak kode terlalu pendek, huruf kecil, atau simbol", () => {
    expect(isValidGiftCardCodeFormat("AB12")).toBe(false);
    expect(isValidGiftCardCodeFormat("abcd2345efgh")).toBe(false);
    expect(isValidGiftCardCodeFormat("ABCD-2345-EFGH")).toBe(false);
  });
});

describe("isGiftCardExpired", () => {
  test("tanpa expiresAt tidak pernah kedaluwarsa", () => {
    expect(isGiftCardExpired(null, "2027-01-01")).toBe(false);
  });

  test("kedaluwarsa saat now melewati expiresAt", () => {
    expect(isGiftCardExpired("2026-08-01", "2026-08-02")).toBe(true);
    expect(isGiftCardExpired("2026-08-01", "2026-08-01")).toBe(false);
    expect(isGiftCardExpired("2026-08-01", "2026-07-31")).toBe(false);
  });
});

describe("evaluateGiftCardRedeem", () => {
  test("redeem penuh menghabiskan saldo → status exhausted", () => {
    const result = evaluateGiftCardRedeem(card({ balance: 50_000 }), 50_000, "2026-08-01");
    expect(result).toEqual({ ok: true, balanceAfter: 0, statusAfter: "exhausted" });
  });

  test("redeem sebagian menyisakan saldo → status tetap active", () => {
    const result = evaluateGiftCardRedeem(card({ balance: 100_000 }), 30_000, "2026-08-01");
    expect(result).toEqual({ ok: true, balanceAfter: 70_000, statusAfter: "active" });
  });

  test("menolak saldo kurang", () => {
    const result = evaluateGiftCardRedeem(card({ balance: 10_000 }), 50_000, "2026-08-01");
    expect(result).toEqual({ ok: false, reason: "saldo-kurang" });
  });

  test("menolak nominal nol atau negatif", () => {
    expect(evaluateGiftCardRedeem(card(), 0, "2026-08-01")).toEqual({
      ok: false,
      reason: "nominal-tidak-valid",
    });
    expect(evaluateGiftCardRedeem(card(), -1000, "2026-08-01")).toEqual({
      ok: false,
      reason: "nominal-tidak-valid",
    });
  });

  test.each(["disabled", "exhausted", "pending"] as const)(
    "menolak kartu berstatus %s",
    (status) => {
      const result = evaluateGiftCardRedeem(card({ status }), 10_000, "2026-08-01");
      expect(result).toEqual({ ok: false, reason: "nonaktif" });
    }
  );

  test("menolak kartu kedaluwarsa (status maupun tanggal lewat)", () => {
    expect(
      evaluateGiftCardRedeem(card({ status: "expired" }), 10_000, "2026-08-01")
    ).toEqual({ ok: false, reason: "kedaluwarsa" });
    expect(
      evaluateGiftCardRedeem(
        card({ expiresAt: "2026-07-01" }),
        10_000,
        "2026-08-01"
      )
    ).toEqual({ ok: false, reason: "kedaluwarsa" });
  });
});

describe("computeBalanceAfterIssue", () => {
  test("menambah saldo dari nominal isi/top-up", () => {
    expect(computeBalanceAfterIssue(0, 100_000)).toBe(100_000);
    expect(computeBalanceAfterIssue(50_000, 25_000)).toBe(75_000);
  });

  test("menolak nominal isi nol atau negatif", () => {
    expect(() => computeBalanceAfterIssue(0, 0)).toThrow();
    expect(() => computeBalanceAfterIssue(0, -1)).toThrow();
  });
});

describe("computeBalanceAfterCorrection", () => {
  test("mengizinkan koreksi naik maupun turun", () => {
    expect(computeBalanceAfterCorrection(50_000, 10_000)).toBe(60_000);
    expect(computeBalanceAfterCorrection(50_000, -10_000)).toBe(40_000);
  });

  test("menolak koreksi yang membuat saldo negatif", () => {
    expect(() => computeBalanceAfterCorrection(10_000, -20_000)).toThrow();
  });
});

// ── Fase B — konfigurasi nominal & masa berlaku ────────────────────────
// Keputusan owner #4: nominal preset dan expiry CONFIGURABLE, bukan angka
// tetap di kode. Nilai rusak dari app_settings jatuh ke default aman.

describe("parseGiftCardConfig", () => {
  test("raw kosong/null jatuh ke default", () => {
    expect(parseGiftCardConfig(null)).toEqual(DEFAULT_GIFT_CARD_CONFIG);
    expect(parseGiftCardConfig({})).toEqual(DEFAULT_GIFT_CARD_CONFIG);
  });

  test("membersihkan preset: buang non-positif, dedupe, urut naik", () => {
    const config = parseGiftCardConfig({
      presets: [200_000, 50_000, 50_000, 0, -1000, 100_000],
    });
    expect(config.presets).toEqual([50_000, 100_000, 200_000]);
  });

  test("preset yang seluruhnya tidak valid jatuh ke default", () => {
    expect(parseGiftCardConfig({ presets: [] }).presets).toEqual(
      DEFAULT_GIFT_CARD_CONFIG.presets
    );
    expect(parseGiftCardConfig({ presets: "banyak" }).presets).toEqual(
      DEFAULT_GIFT_CARD_CONFIG.presets
    );
    expect(parseGiftCardConfig({ presets: [0, -5] }).presets).toEqual(
      DEFAULT_GIFT_CARD_CONFIG.presets
    );
  });

  test("membatasi jumlah preset supaya UI kasir tidak meledak", () => {
    const many = Array.from({ length: 30 }, (_, i) => (i + 1) * 10_000);
    expect(parseGiftCardConfig({ presets: many }).presets).toHaveLength(12);
  });

  test("expiry_months: null = tanpa kedaluwarsa, angka dijepit 1..120", () => {
    expect(parseGiftCardConfig({ expiry_months: null }).expiry_months).toBeNull();
    expect(parseGiftCardConfig({ expiry_months: 12 }).expiry_months).toBe(12);
    expect(parseGiftCardConfig({ expiry_months: 0 }).expiry_months).toBe(1);
    expect(parseGiftCardConfig({ expiry_months: 999 }).expiry_months).toBe(120);
    expect(parseGiftCardConfig({ expiry_months: "dua" }).expiry_months).toBeNull();
  });

  test("allow_custom hanya true bila eksplisit boolean true", () => {
    expect(parseGiftCardConfig({ allow_custom: true }).allow_custom).toBe(true);
    expect(parseGiftCardConfig({ allow_custom: false }).allow_custom).toBe(false);
    expect(parseGiftCardConfig({ allow_custom: "ya" }).allow_custom).toBe(
      DEFAULT_GIFT_CARD_CONFIG.allow_custom
    );
  });
});

describe("isAllowedGiftCardNominal", () => {
  const config = (patch: Partial<GiftCardConfig> = {}): GiftCardConfig => ({
    ...DEFAULT_GIFT_CARD_CONFIG,
    ...patch,
  });

  test("nominal bebas diizinkan saat allow_custom true", () => {
    expect(isAllowedGiftCardNominal(config({ allow_custom: true }), 75_000)).toBe(true);
  });

  test("nominal di luar preset ditolak saat allow_custom false", () => {
    const c = config({ allow_custom: false, presets: [50_000, 100_000] });
    expect(isAllowedGiftCardNominal(c, 100_000)).toBe(true);
    expect(isAllowedGiftCardNominal(c, 75_000)).toBe(false);
  });

  test("menolak nol, negatif, dan bukan angka", () => {
    const c = config({ allow_custom: true });
    expect(isAllowedGiftCardNominal(c, 0)).toBe(false);
    expect(isAllowedGiftCardNominal(c, -50_000)).toBe(false);
    expect(isAllowedGiftCardNominal(c, Number.NaN)).toBe(false);
    expect(isAllowedGiftCardNominal(c, Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("menolak pecahan rupiah — saldo gift card selalu bulat", () => {
    expect(isAllowedGiftCardNominal(config({ allow_custom: true }), 50_000.5)).toBe(false);
  });

  test("menolak nominal di atas plafon aman (salah ketik kasir)", () => {
    const c = config({ allow_custom: true });
    expect(isAllowedGiftCardNominal(c, 100_000_000)).toBe(true);
    expect(isAllowedGiftCardNominal(c, 100_000_001)).toBe(false);
  });
});

describe("resolveGiftCardExpiry", () => {
  test("tanpa expiry_months → kartu tanpa kedaluwarsa", () => {
    expect(resolveGiftCardExpiry(null, "2026-07-27T10:00:00.000Z")).toBeNull();
  });

  test("menambah bulan dari tanggal terbit", () => {
    expect(resolveGiftCardExpiry(6, "2026-07-27T10:00:00.000Z")).toBe(
      "2027-01-27T10:00:00.000Z"
    );
    expect(resolveGiftCardExpiry(12, "2026-07-27T10:00:00.000Z")).toBe(
      "2027-07-27T10:00:00.000Z"
    );
  });

  test("tanggal akhir bulan tidak meluber ke bulan berikutnya", () => {
    // 31 Jan + 1 bulan = 28 Feb (bukan 3 Mar hasil overflow setUTCMonth)
    expect(resolveGiftCardExpiry(1, "2026-01-31T00:00:00.000Z")).toBe(
      "2026-02-28T00:00:00.000Z"
    );
    // tahun kabisat
    expect(resolveGiftCardExpiry(1, "2028-01-31T00:00:00.000Z")).toBe(
      "2028-02-29T00:00:00.000Z"
    );
  });
});

// ── Fase C — void order mengembalikan saldo ────────────────────────────

describe("resolveStatusAfterRefund", () => {
  test("kartu yang sempat habis hidup lagi saat saldo kembali", () => {
    expect(resolveStatusAfterRefund("exhausted", 50_000)).toBe("active");
  });

  test("kartu aktif tetap aktif", () => {
    expect(resolveStatusAfterRefund("active", 50_000)).toBe("active");
  });

  test("refund nol tetap exhausted", () => {
    expect(resolveStatusAfterRefund("exhausted", 0)).toBe("exhausted");
    expect(resolveStatusAfterRefund("active", 0)).toBe("exhausted");
  });

  test("kartu yang dimatikan admin atau kedaluwarsa TIDAK ikut hidup lagi", () => {
    expect(resolveStatusAfterRefund("disabled", 50_000)).toBe("disabled");
    expect(resolveStatusAfterRefund("expired", 50_000)).toBe("expired");
  });
});
