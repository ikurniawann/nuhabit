import { describe, expect, it } from "vitest";
import { CARD_UNLINK_REASON_LABELS, validateCardUnlink } from "./card-unlink";

describe("validateCardUnlink", () => {
  it("menerima alasan hilang / dikembalikan tanpa keterangan", () => {
    expect(validateCardUnlink({ reason: "lost" })).toEqual({ ok: true, reason: "lost", notes: null });
    expect(validateCardUnlink({ reason: "returned", notes: "  " })).toEqual({
      ok: true,
      reason: "returned",
      notes: null,
    });
  });

  it("alasan 'lainnya' wajib berketerangan", () => {
    const res = validateCardUnlink({ reason: "other", notes: "" });
    expect(res.ok).toBe(false);
    const ok = validateCardUnlink({ reason: "other", notes: "Kartu rusak, diganti baru" });
    expect(ok).toEqual({ ok: true, reason: "other", notes: "Kartu rusak, diganti baru" });
  });

  it("menolak alasan tak dikenal atau keterangan kepanjangan", () => {
    expect(validateCardUnlink({ reason: "stolen" }).ok).toBe(false);
    expect(validateCardUnlink({}).ok).toBe(false);
    expect(validateCardUnlink({ reason: "lost", notes: "x".repeat(501) }).ok).toBe(false);
  });

  it("label alasan tersedia untuk semua nilai", () => {
    expect(CARD_UNLINK_REASON_LABELS.lost).toBe("Kartu hilang");
    expect(CARD_UNLINK_REASON_LABELS.returned).toBe("Kartu dikembalikan");
    expect(CARD_UNLINK_REASON_LABELS.other).toBe("Lainnya");
  });
});
