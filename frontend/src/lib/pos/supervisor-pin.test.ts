import { describe, expect, it } from "vitest";

import {
  findSupervisorByPin,
  hashPosPin,
  isValidPosPin,
  verifyPosPin,
} from "./supervisor-pin";

/**
 * Tes ditulis lebih dulu — UI kelola PIN supervisor POS (permintaan owner
 * 2026-08-16). Kontrak yang dikunci:
 * - PIN 4–6 digit angka.
 * - Disimpan sebagai hash bcrypt, BUKAN plaintext.
 * - PIN plaintext lama di DB tetap diterima (backward compat) sampai
 *   supervisor di-reset lewat UI baru — void tidak boleh macet saat transisi.
 */

describe("isValidPosPin", () => {
  it("menerima 4-6 digit angka", () => {
    expect(isValidPosPin("1234")).toBe(true);
    expect(isValidPosPin("123456")).toBe(true);
  });

  it("menolak selain itu", () => {
    expect(isValidPosPin("123")).toBe(false);
    expect(isValidPosPin("1234567")).toBe(false);
    expect(isValidPosPin("12a4")).toBe(false);
    expect(isValidPosPin("")).toBe(false);
    expect(isValidPosPin("12 34")).toBe(false);
  });
});

describe("hashPosPin + verifyPosPin", () => {
  it("hash bcrypt terverifikasi dan tidak menyimpan plaintext", async () => {
    const hash = await hashPosPin("1234");
    expect(hash).not.toContain("1234");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPosPin("1234", hash)).toBe(true);
    expect(await verifyPosPin("9999", hash)).toBe(false);
  });

  it("PIN plaintext lama tetap cocok (transisi)", async () => {
    expect(await verifyPosPin("1234", "1234")).toBe(true);
    expect(await verifyPosPin("1234", "5678")).toBe(false);
  });

  it("stored kosong/null selalu gagal", async () => {
    expect(await verifyPosPin("1234", null)).toBe(false);
    expect(await verifyPosPin("1234", "")).toBe(false);
  });
});

describe("findSupervisorByPin", () => {
  it("menemukan supervisor yang PIN-nya cocok (hash maupun legacy)", async () => {
    const hash = await hashPosPin("4321");
    const rows = [
      { id: "a", full_name: "Andi", pos_pin: hash },
      { id: "b", full_name: "Budi", pos_pin: "1111" },
      { id: "c", full_name: "Cici", pos_pin: null },
    ];
    expect((await findSupervisorByPin(rows, "4321"))?.id).toBe("a");
    expect((await findSupervisorByPin(rows, "1111"))?.id).toBe("b");
    expect(await findSupervisorByPin(rows, "0000")).toBeNull();
  });
});
