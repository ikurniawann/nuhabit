import { describe, expect, it } from "vitest";

import {
  buildReservationQueueWaMessage,
  formatReservationQueueNumber,
} from "./reservation-queue";

/**
 * Tes ditulis lebih dulu — nomor antrian reservasi/waiting list (permintaan
 * owner 2026-08-16): tamu yang mendaftar (walk-in menunggu meja maupun
 * reservasi) mendapat nomor antrian W-xx, bisa dicetak dan dikirim via WA.
 */

describe("formatReservationQueueNumber", () => {
  it("format W-xx dua digit", () => {
    expect(formatReservationQueueNumber(7)).toBe("W-07");
    expect(formatReservationQueueNumber(42)).toBe("W-42");
    expect(formatReservationQueueNumber(123)).toBe("W-123");
  });

  it("nomor kosong/tidak sah → null (baris lama tanpa nomor)", () => {
    expect(formatReservationQueueNumber(null)).toBeNull();
    expect(formatReservationQueueNumber(undefined)).toBeNull();
    expect(formatReservationQueueNumber(0)).toBeNull();
  });
});

describe("buildReservationQueueWaMessage", () => {
  it("template Indonesia memuat nomor antrian, tanggal, jam, jumlah tamu", () => {
    const msg = buildReservationQueueWaMessage({
      guestName: "Budi",
      queueLabel: "W-07",
      dateLabel: "Sabtu, 16 Agustus 2026",
      timeLabel: "19:00",
      paxCount: 3,
      merchantName: "BCD Coffee",
    });
    expect(msg).toContain("Budi");
    expect(msg).toContain("*W-07*");
    expect(msg).toContain("Sabtu, 16 Agustus 2026");
    expect(msg).toContain("19:00");
    expect(msg).toContain("3 orang");
    expect(msg).toContain("BCD Coffee");
    expect(msg).toContain("dipanggil");
  });

  it("nama meja ikut bila sudah ditetapkan", () => {
    const msg = buildReservationQueueWaMessage({
      guestName: "Budi",
      queueLabel: "W-07",
      dateLabel: "Sabtu, 16 Agustus 2026",
      timeLabel: "19:00",
      paxCount: 2,
      tableLabel: "T-12",
      merchantName: "Sulu",
    });
    expect(msg).toContain("Meja: T-12");
  });
});
