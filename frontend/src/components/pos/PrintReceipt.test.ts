import { describe, expect, it } from "vitest";
import {
  buildReceiptEscPosBytes,
  buildReceiptHtml,
  buildReceiptLines,
  type ReceiptPayload,
} from "./PrintReceipt";
import { MEMBER_PORTAL_URL } from "@/lib/pos/member-qr";

const mixedPayload: ReceiptPayload = {
  checkoutNumber: "CHK-20260815-0001",
  queueNumber: "A7",
  orderType: "dine_in",
  table: null,
  items: [
    { id: "1", productId: "p1", name: "Americano", price: 20000, quantity: 1, warehouse_name: "Kopi Nusantara" },
    { id: "2", productId: "p2", name: "Croissant", price: 18000, quantity: 1, warehouse_name: "Bakery" },
  ],
  notes: "",
  total: 38000,
  change: 2000,
  paymentMethod: "cash",
  discountAmount: 0,
  taxAmount: 0,
};

describe("buildReceiptLines mixed checkout", () => {
  it("prints one checkout number, per-item stall tags, one total, and one tender", () => {
    const lines = buildReceiptLines(mixedPayload, "CUSTOMER");
    expect(lines).toContain("Checkout #CHK-20260815-0001");
    expect(lines).toContain("ANTRIAN A7");
    // Header "--- Stall ---" dihapus — label [Stall] per item sudah cukup
    expect(lines.some((line) => line.includes("--- Kopi Nusantara ---"))).toBe(false);
    expect(lines.some((line) => line.startsWith("1x Americano"))).toBe(true);
    expect(lines).toContain("  [Kopi Nusantara]");
    expect(lines.some((line) => line.startsWith("1x Croissant"))).toBe(true);
    expect(lines).toContain("  [Bakery]");
    expect(lines.filter((line) => line.startsWith("TOTAL")).length).toBe(1);
    expect(lines.some((line) => line.includes("Bayar (CASH)"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Order #"))).toBe(false);
  });
});

describe("receipt header/footer dari konfigurasi (EPIC-040)", () => {
  const decorated: ReceiptPayload = {
    ...mixedPayload,
    receiptHeader: ["BCD COFFEE", "Jl. Alamat Outlet No. 1"],
    receiptFooter: ["Terima kasih!", "WiFi: SULU-GUEST"],
  };

  it("customer copy memuat header di atas dan footer sebelum copy marker", () => {
    const lines = buildReceiptLines(decorated, "CUSTOMER");
    expect(lines[0]).toBe("BCD COFFEE");
    expect(lines[1]).toBe("Jl. Alamat Outlet No. 1");
    expect(lines.indexOf("--- CUSTOMER ---")).toBeGreaterThan(1);
    const footerIdx = lines.indexOf("Terima kasih!");
    expect(footerIdx).toBeGreaterThan(lines.findIndex((l) => l.startsWith("TOTAL")));
    expect(lines.indexOf("--- CUSTOMER COPY ---")).toBeGreaterThan(footerIdx);
  });

  it("copy dapur/bar tidak memuat header maupun footer", () => {
    for (const label of ["KITCHEN", "BAR"] as const) {
      const lines = buildReceiptLines(decorated, label);
      expect(lines).not.toContain("BCD COFFEE");
      expect(lines).not.toContain("Terima kasih!");
      expect(lines[0]).toBe(`--- ${label} ---`);
    }
  });

  it("payload tanpa konfigurasi identik dengan sebelum EPIC-040", () => {
    expect(buildReceiptLines(mixedPayload, "CUSTOMER")[0]).toBe("--- CUSTOMER ---");
  });

  it("blok ARK: harga, dibayar, sisa saldo — hanya pembayaran ark_coin (EPIC-041)", () => {
    const arkPayload: ReceiptPayload = {
      ...mixedPayload,
      paymentMethod: "ark_coin",
      total: 2400,
      arkPaid: 2400,
      arkBalanceAfter: 200,
      arkRate: 1000,
    };
    const lines = buildReceiptLines(arkPayload, "CUSTOMER");
    expect(lines.some((l) => l.startsWith("Harga") && l.includes("2 ARK"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Dibayar ARK") && l.includes("2 ARK"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Sisa saldo") && l.includes("0 ARK") && l.includes("Rp 200"))).toBe(true);
    // copy dapur & pembayaran non-ARK tidak memuat blok ini
    expect(buildReceiptLines(arkPayload, "KITCHEN").some((l) => l.includes("Sisa saldo"))).toBe(false);
    expect(
      buildReceiptLines({ ...arkPayload, paymentMethod: "cash" }, "CUSTOMER").some((l) =>
        l.includes("Dibayar ARK")
      )
    ).toBe(false);
  });

  it("pembayaran ARK: harga item, subtotal, total inline 'Rp X / N Ark Coin'", () => {
    // Struk live membawa LABEL metode ("ARK Coin"), bukan kode 'ark_coin' —
    // deteksi harus tetap jalan (bug produksi 2026-08-23).
    for (const method of ["ark_coin", "ARK Coin"]) {
      const arkPayload: ReceiptPayload = {
        ...mixedPayload,
        paymentMethod: method,
        arkRate: 1000,
      };
      const lines = buildReceiptLines(arkPayload, "CUSTOMER");
      expect(lines.some((l) => l.includes("Rp 20.000 / 20 Ark Coin"))).toBe(true);
      expect(lines.some((l) => l.includes("Rp 18.000 / 18 Ark Coin"))).toBe(true);
      expect(
        lines.some((l) => l.startsWith("Subtotal") && l.includes("Rp 38.000 / 38 Ark Coin"))
      ).toBe(true);
      expect(
        lines.some((l) => l.startsWith("TOTAL") && l.includes("Rp 38.000 / 38 Ark Coin"))
      ).toBe(true);
      // arkPaid absen → fallback ke total; blok ARK tetap tercetak
      expect(lines.some((l) => l.startsWith("Dibayar ARK") && l.includes("38 ARK"))).toBe(true);
      // copy dapur bebas dari konversi & harga
      expect(buildReceiptLines(arkPayload, "KITCHEN").some((l) => l.includes("Ark Coin"))).toBe(false);
    }
    // non-ARK bebas dari konversi
    expect(buildReceiptLines(mixedPayload, "CUSTOMER").some((l) => l.includes("Ark Coin"))).toBe(false);
  });

  it("blok XP: +N dan total member — hanya bila ada XP (EPIC-041)", () => {
    const xpPayload: ReceiptPayload = { ...mixedPayload, xpEarned: 8, xpTotalAfter: 508 };
    const lines = buildReceiptLines(xpPayload, "CUSTOMER");
    expect(lines.some((l) => l.startsWith("XP didapat") && l.includes("+8 XP"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Total XP") && l.includes("508 XP"))).toBe(true);
    expect(buildReceiptLines(xpPayload, "KITCHEN").some((l) => l.includes("XP"))).toBe(false);
    expect(
      buildReceiptLines({ ...mixedPayload, xpEarned: 0, xpTotalAfter: 508 }, "CUSTOMER").some(
        (l) => l.includes("XP")
      )
    ).toBe(false);
  });

  it("receiptShowStallName=false menyembunyikan baris Stall hanya di customer copy", () => {
    const withStall: ReceiptPayload = {
      ...decorated,
      stallName: "Yakitori Stall",
      receiptShowStallName: false,
    };
    expect(buildReceiptLines(withStall, "CUSTOMER")).not.toContain("Stall: Yakitori Stall");
    expect(buildReceiptLines(withStall, "KITCHEN")).toContain("Stall: Yakitori Stall");
    const shown: ReceiptPayload = { ...withStall, receiptShowStallName: true };
    expect(buildReceiptLines(shown, "CUSTOMER")).toContain("Stall: Yakitori Stall");
  });
});

describe("komplimen di struk (EPIC-043)", () => {
  it("KOL: label gratis menggantikan baris Bayar", () => {
    const lines = buildReceiptLines(
      { ...mixedPayload, total: 0, discountAmount: 38000, compType: "kol_comp" },
      "CUSTOMER"
    );
    expect(lines).toContain("KOL COMPLIMENTARY — GRATIS");
    expect(lines.some((l) => l.startsWith("Bayar ("))).toBe(false);
  });

  it("Owner: label memuat nama penyetuju", () => {
    const lines = buildReceiptLines(
      {
        ...mixedPayload,
        total: 0,
        discountAmount: 38000,
        compType: "owner_comp",
        compApprovedName: "Ricky Ardiansyah",
      },
      "CUSTOMER"
    );
    expect(lines).toContain("OWNER COMP — Disetujui: Ricky Ardiansyah");
  });

  it("preview bill memuat blok tanda tangan", () => {
    const lines = buildReceiptLines(mixedPayload, "PREVIEW_BILL");
    expect(lines).toContain("Disetujui:");
    expect(lines).toContain("____________________");
    expect(lines.some((l) => l.startsWith("Nama:"))).toBe(true);
  });
});

describe("QR member portal di bawah struk", () => {
  const bytesToAscii = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join("");

  it("ESC/POS customer copy memuat perintah QR + URL; dapur/bar tidak", () => {
    const ascii = bytesToAscii(buildReceiptEscPosBytes(mixedPayload, "CUSTOMER"));
    // GS ( k fn 165 pilih model QR — penanda blok QR dimulai
    expect(ascii).toContain("\x1d\x28\x6b\x04\x00\x31\x41\x32\x00");
    expect(ascii).toContain(MEMBER_PORTAL_URL);
    expect(ascii).toContain("member.suluinwounderland.com");
    const kitchen = bytesToAscii(buildReceiptEscPosBytes(mixedPayload, "KITCHEN"));
    expect(kitchen).not.toContain(MEMBER_PORTAL_URL);
  });

  it("HTML customer copy memuat SVG QR + caption; dapur tidak", () => {
    const html = buildReceiptHtml(mixedPayload, "CUSTOMER");
    expect(html).toContain("viewBox=\"0 0 29 29\"");
    expect(html).toContain("member.suluinwounderland.com");
    const kitchen = buildReceiptHtml(mixedPayload, "KITCHEN");
    expect(kitchen).not.toContain("viewBox=\"0 0 29 29\"");
  });
});
