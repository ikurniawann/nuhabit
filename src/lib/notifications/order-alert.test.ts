import { describe, expect, it } from "vitest";
import { isTelegramBotToken } from "@/lib/telegram/client";
import { buildOrderAlertMessage, parseOrderAlertConfig } from "./order-alert";

describe("buildOrderAlertMessage", () => {
  it("meja, antrean, item + varian/add-on, catatan, total & status bayar", () => {
    const text = buildOrderAlertMessage({
      brandName: "BCD Coffee",
      sourceLabel: "Self-order QR",
      tableLabel: "WIT. Office Bandung",
      orderType: "dine_in",
      queueNumber: "004",
      orderNumber: "POS-20260928-0004",
      paymentLabel: "Bayar di kasir",
      paid: false,
      guestName: "Budi",
      guestPhone: "6281234567890",
      customerNote: "less ice",
      total: 48000,
      items: [
        { name: "Iced Orange Black", quantity: 1 },
        { name: "Iced Latte", quantity: 2, variant: "Regular", modifiers: ["Extra Shot Espresso", "Oat Milk"] },
      ],
    });
    expect(text).toBe(
      [
        "🛎️ Pesanan baru — Self-order QR",
        "BCD Coffee",
        "Meja WIT. Office Bandung · Makan di tempat",
        "Antrean 004 · POS-20260928-0004",
        "Atas nama: Budi · WA 081234567890",
        "",
        "• 1× Iced Orange Black",
        "• 2× Iced Latte (Regular, Extra Shot Espresso, Oat Milk)",
        "\nCatatan: less ice",
        "",
        "Total Rp48.000 · Bayar di kasir (belum dibayar)",
      ].join("\n")
    );
  });

  it("bawa pulang & lunas, tanpa meja/nama/catatan", () => {
    const text = buildOrderAlertMessage({
      brandName: "BCD Coffee",
      sourceLabel: "Self-order QR",
      tableLabel: null,
      orderType: "takeaway",
      queueNumber: null,
      orderNumber: "POS-1",
      paymentLabel: "ARK Coin",
      paid: true,
      total: 25000,
      items: [{ name: "Iced Bold", quantity: 1 }],
    });
    expect(text).toContain("Bawa pulang");
    expect(text).toContain("Antrean - · POS-1");
    expect(text).toContain("ARK Coin (lunas)");
    expect(text).not.toContain("Atas nama");
    expect(text).not.toContain("Catatan");
  });
});

describe("parseOrderAlertConfig", () => {
  it("default: WA ke role pos, Telegram aktif", () => {
    expect(parseOrderAlertConfig(null)).toEqual({ waEnabled: true, waRoles: ["pos"], telegramEnabled: true });
    expect(parseOrderAlertConfig("{rusak")).toEqual({ waEnabled: true, waRoles: ["pos"], telegramEnabled: true });
  });

  it("role asing dibuang; nilai tersimpan dihormati", () => {
    expect(
      parseOrderAlertConfig(JSON.stringify({ waEnabled: false, waRoles: ["pos_supervisor", "super_admin"], telegramEnabled: false }))
    ).toEqual({ waEnabled: false, waRoles: ["pos_supervisor"], telegramEnabled: false });
  });
});

describe("isTelegramBotToken", () => {
  it("bentuk token BotFather", () => {
    expect(isTelegramBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true);
    expect(isTelegramBotToken("bukan-token")).toBe(false);
    expect(isTelegramBotToken("123:abc")).toBe(false);
  });
});

describe("nama pemesan member", () => {
  it("member ditandai (member)", () => {
    const text = buildOrderAlertMessage({
      brandName: "BCD Coffee", sourceLabel: "Self-order QR", tableLabel: "A1", orderType: "dine_in",
      queueNumber: "001", orderNumber: "POS-1", paymentLabel: "ARK Coin", paid: true, total: 1000,
      guestName: "Riksa", guestPhone: "081200001111", isMember: true, items: [{ name: "Espresso", quantity: 1 }],
    });
    expect(text).toContain("Atas nama: Riksa (member) · WA 081200001111");
  });
});
