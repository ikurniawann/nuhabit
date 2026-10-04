import { describe, expect, it } from "vitest";
import { buildTopupReceiptEscPosBytes } from "@/features/pos/topup/print-topup-receipt";

describe("buildTopupReceiptEscPosBytes", () => {
  it("encodes TOPUP header matching HTML ticket", () => {
    const bytes = buildTopupReceiptEscPosBytes({
      customerName: "Budi",
      phone: "0812",
      amount: 50000,
      arkAmountLabel: "50 ARK",
      paymentMethod: "cash",
      balanceBeforeLabel: "10 ARK",
      balanceAfterLabel: "60 ARK",
      amountLabel: "Rp 50.000",
      cardId: "AABB",
    });
    const text = String.fromCharCode(...Array.from(bytes).filter((b) => b >= 32 && b < 127));
    expect(text).toContain("TOPUP");
    expect(text).toContain("ARK E-MONEY");
    expect(text).toContain("Budi");
    expect(text).toContain("Balance");
  });
});

describe("buildTopupReceiptHtml", () => {
  it("escapes member-controlled values so they cannot inject markup", async () => {
    const { buildTopupReceiptHtml } = await import("@/features/pos/topup/print-topup-receipt");
    const html = buildTopupReceiptHtml(
      {
        customerName: `<img src=x onerror="alert(1)">`,
        phone: "<script>alert(2)</script>",
        amount: 50000,
        arkAmountLabel: "50 ARK",
        paymentMethod: "cash",
        balanceBeforeLabel: "10 ARK",
        balanceAfterLabel: "60 ARK",
        amountLabel: "Rp 50.000",
        cardId: `"><b>`,
      },
      "4/10/2026"
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(`"><b>`);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("CASH");
  });
});
