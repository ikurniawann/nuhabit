import { describe, expect, it } from "vitest";
import { evaluateApPaymentVoid } from "./ap-void";

const posted = { id: "p1", status: "POSTED", deleted_at: null };

describe("evaluateApPaymentVoid", () => {
  it("mengizinkan void pembayaran POSTED dengan alasan", () => {
    expect(evaluateApPaymentVoid(posted, "Salah transfer ke rekening")).toBeNull();
  });

  it("alasan wajib", () => {
    expect(evaluateApPaymentVoid(posted, "")).toMatchObject({ status: 400 });
    expect(evaluateApPaymentVoid(posted, "   ok  ")).toMatchObject({ status: 400 });
    expect(evaluateApPaymentVoid(posted, null)).toMatchObject({ status: 400 });
  });

  it("menolak void ganda", () => {
    expect(evaluateApPaymentVoid({ ...posted, status: "VOID" }, "Salah transfer")).toEqual({
      status: 409,
      message: "Pembayaran ini sudah di-void",
    });
  });

  it("menolak pembayaran draft", () => {
    expect(evaluateApPaymentVoid({ ...posted, status: "DRAFT" }, "Salah transfer")).toMatchObject({ status: 409 });
  });

  it("pembayaran tidak ada atau terhapus = 404", () => {
    expect(evaluateApPaymentVoid(null, "Salah transfer")).toMatchObject({ status: 404 });
    expect(evaluateApPaymentVoid({ ...posted, deleted_at: "2026-10-01" }, "Salah transfer")).toMatchObject({ status: 404 });
  });
});
