import { describe, expect, it } from "vitest";
import { buildRefundWalletNotes, isRefundOpen, normalizeNotes, refundCompletedMessage } from "./member-refund";

describe("member-refund helpers", () => {
  it("hanya status requested yang bisa diproses", () => {
    expect(isRefundOpen("requested")).toBe(true);
    expect(isRefundOpen("completed")).toBe(false);
    expect(isRefundOpen(null)).toBe(false);
  });

  it("normalizeNotes: trim, kosong → null, batas panjang", () => {
    expect(normalizeNotes("  transfer BCA 1234  ")).toEqual({ ok: true, notes: "transfer BCA 1234" });
    expect(normalizeNotes("")).toEqual({ ok: true, notes: null });
    expect(normalizeNotes("x".repeat(501)).ok).toBe(false);
  });

  it("catatan wallet & pesan sukses", () => {
    expect(buildRefundWalletNotes({ approverName: "Budi", requestId: "abcdef12-0000" })).toContain("disetujui Budi");
    expect(buildRefundWalletNotes({ approverName: null, requestId: "abcdef12-0000" })).toContain("supervisor");
    expect(refundCompletedMessage({ name: "Ani", amount: 67350 })).toBe("Refund Ani selesai — Rp67.350 dikembalikan, saldo member kini Rp0");
    expect(refundCompletedMessage({ name: null, phone: "0812", amount: 0 })).toContain("Refund 0812 selesai");
  });
});
