import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/whatsapp/gateway", () => ({
  loadGatewayConfig: vi.fn(),
  sendGatewayText: vi.fn(),
}));
vi.mock("@/lib/app-origin", () => ({ appOrigin: () => "https://tiket.example" }));

const { buildBookingGiftMessage, buildBookingPaidMessage } = await import("./booking-wa");
const { buildPassPaidMessage } = await import("./pass-wa");

const booking = {
  booking_code: "BK-ABC234",
  access_token: "tok",
  visit_date: "2026-10-04",
  customer_name: "Budi",
  customer_phone: "6281",
  total: "150000",
};

describe("pesan WA booking", () => {
  test("tanpa promo: satu baris total, tanggal panjang WIB, link status", () => {
    const message = buildBookingPaidMessage(booking);
    expect(message).toContain("Kode booking: *BK-ABC234*");
    expect(message).toContain("Tanggal kunjungan: Minggu, 4 Oktober 2026");
    expect(message).toContain("Total: Rp150.000\n\n");
    expect(message).not.toContain("Potongan promo");
    expect(message).toContain("https://tiket.example/booking/status/tok");
  });

  test("dengan promo: rincian potongan dan jumlah dibayar", () => {
    const message = buildBookingPaidMessage({ ...booking, discount_amount: "25000" });
    expect(message).toContain("Total: Rp150.000\nPotongan promo: -Rp25.000\nDibayar: Rp125.000");
  });

  test("hadiah: pemesan diberi tahu, penerima dapat e-tiket", () => {
    const gift = { ...booking, gift_recipient_name: "Ani", gift_recipient_phone: "6282" };
    expect(buildBookingPaidMessage(gift)).toContain("E-tiket HADIAH telah dikirim ke WA Ani");
    const toRecipient = buildBookingGiftMessage(gift);
    expect(toRecipient).toContain("Dari: Budi\nUntuk: *Ani*");
    expect(toRecipient).toContain("Tanggal kunjungan: Minggu, 4 Oktober 2026");
  });
});

test("pesan WA pass aktif memakai tanggal singkat", () => {
  const message = buildPassPaidMessage({
    pass_code: "SP-20261004-0001",
    access_token: "pt",
    holder_name: "Budi",
    holder_phone: "6281",
    valid_until: "2027-10-04",
  });
  expect(message).toContain("Berlaku s/d: 4 Okt 2027");
  expect(message).toContain("https://tiket.example/pass/status/pt");
});
