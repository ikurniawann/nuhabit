import { describe, expect, test } from "vitest";
import {
  GIFT_CARD_RELOAD_REJECT_MESSAGES,
  MAX_GIFT_CARD_VALUE,
  evaluateGiftCardReload,
  phoneMatchKey,
  type GiftCardStatus,
} from "./giftcard";
import { giftCardReloadSchema } from "./reload-schema";

const NOW = "2026-10-04T05:00:00.000Z";

const card = (patch: Partial<{
  status: GiftCardStatus;
  balance: number;
  expiresAt: string | null;
  reloadedTotal: number;
}> = {}) => ({
  status: "active" as GiftCardStatus,
  balance: 20_000,
  expiresAt: null,
  reloadedTotal: 0,
  ...patch,
});

describe("evaluateGiftCardReload", () => {
  test("menambah saldo dan total reload", () => {
    expect(evaluateGiftCardReload(card(), 50_000, NOW)).toEqual({
      ok: true,
      balanceAfter: 70_000,
      reloadedTotalAfter: 50_000,
      statusAfter: "active",
    });
  });

  test("reload berulang mengakumulasi total reload (batas saldo ledger)", () => {
    const first = evaluateGiftCardReload(card(), 10_000, NOW);
    if (!first.ok) throw new Error("reload pertama harus lolos");
    const second = evaluateGiftCardReload(
      card({ balance: first.balanceAfter, reloadedTotal: first.reloadedTotalAfter }),
      15_000,
      NOW
    );
    expect(second).toMatchObject({ ok: true, balanceAfter: 45_000, reloadedTotalAfter: 25_000 });
  });

  test("kartu habis terpakai hidup lagi setelah reload", () => {
    expect(
      evaluateGiftCardReload(card({ status: "exhausted", balance: 0 }), 25_000, NOW)
    ).toMatchObject({ ok: true, balanceAfter: 25_000, statusAfter: "active" });
  });

  test.each<[GiftCardStatus, string]>([
    ["disabled", "nonaktif"],
    ["pending", "nonaktif"],
    ["expired", "kedaluwarsa"],
  ])("status %s ditolak (%s)", (status, reason) => {
    expect(evaluateGiftCardReload(card({ status }), 10_000, NOW)).toEqual({ ok: false, reason });
  });

  test("lewat tanggal kedaluwarsa ditolak walau status masih active", () => {
    expect(
      evaluateGiftCardReload(card({ expiresAt: "2026-10-01T00:00:00.000Z" }), 10_000, NOW)
    ).toEqual({ ok: false, reason: "kedaluwarsa" });
  });

  test("nominal harus rupiah bulat > 0", () => {
    for (const amount of [0, -5_000, 1_000.5]) {
      expect(evaluateGiftCardReload(card(), amount, NOW)).toEqual({
        ok: false,
        reason: "nominal-tidak-valid",
      });
    }
  });

  test("saldo setelah reload tidak boleh melewati plafon", () => {
    expect(
      evaluateGiftCardReload(card({ balance: MAX_GIFT_CARD_VALUE - 1_000 }), 2_000, NOW)
    ).toEqual({ ok: false, reason: "melebihi-plafon" });
  });

  test("setiap alasan punya pesan", () => {
    for (const message of Object.values(GIFT_CARD_RELOAD_REJECT_MESSAGES)) {
      expect(message.length).toBeGreaterThan(5);
    }
  });
});

describe("giftCardReloadSchema", () => {
  test("hanya metode uang masuk nyata", () => {
    expect(giftCardReloadSchema.safeParse({ amount: 50_000, payment_method: "qris" }).success).toBe(true);
    expect(giftCardReloadSchema.safeParse({ amount: 50_000, payment_method: "ark_coin" }).success).toBe(false);
    expect(giftCardReloadSchema.safeParse({ amount: 50_000, payment_method: "gift_card" }).success).toBe(false);
  });

  test("nominal bulat dan positif", () => {
    expect(giftCardReloadSchema.safeParse({ amount: 0, payment_method: "cash" }).success).toBe(false);
    expect(giftCardReloadSchema.safeParse({ amount: 10.5, payment_method: "cash" }).success).toBe(false);
  });
});

describe("phoneMatchKey", () => {
  test("format nomor berbeda menghasilkan kunci sama", () => {
    const key = phoneMatchKey("0812-3456-789");
    expect(phoneMatchKey("+62 812 3456 789")).toBe(key);
    expect(phoneMatchKey("62812345678 9")).toBe(key);
    expect(key).toBe("8123456789");
  });
});
