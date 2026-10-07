import { describe, expect, it } from "vitest";
import {
  evaluateResponseSla,
  formatDuration,
  isWithinBusinessHours,
  parseCsatReply,
  wibDateKey,
  wibHour,
} from "@/lib/crm/cs-rules";

describe("wibHour & wibDateKey — bebas TZ host", () => {
  it("instan UTC dibaca sebagai jam WIB", () => {
    // 03:00 UTC = 10:00 WIB
    expect(wibHour(new Date("2026-07-20T03:00:00Z"))).toBe(10);
    // 16:00 UTC = 23:00 WIB (hari sama)
    expect(wibHour(new Date("2026-07-20T16:00:00Z"))).toBe(23);
    // 18:00 UTC = 01:00 WIB keesokan hari
    expect(wibHour(new Date("2026-07-20T18:00:00Z"))).toBe(1);
  });

  it("tanggal WIB ikut bergeser melewati tengah malam", () => {
    expect(wibDateKey(new Date("2026-07-20T18:00:00Z"))).toBe("2026-07-21");
    expect(wibDateKey(new Date("2026-07-20T16:00:00Z"))).toBe("2026-07-20");
  });
});

describe("isWithinBusinessHours", () => {
  const at = (jamWib: string) => new Date(`2026-07-20T${jamWib}:00+07:00`);

  it("jam operasional normal 10-22", () => {
    expect(isWithinBusinessHours(at("10"), 10, 22)).toBe(true);
    expect(isWithinBusinessHours(at("15"), 10, 22)).toBe(true);
    expect(isWithinBusinessHours(at("21"), 10, 22)).toBe(true);
    expect(isWithinBusinessHours(at("22"), 10, 22)).toBe(false); // batas atas eksklusif
    expect(isWithinBusinessHours(at("09"), 10, 22)).toBe(false);
    expect(isWithinBusinessHours(at("02"), 10, 22)).toBe(false);
  });

  it("rentang melewati tengah malam 20-02", () => {
    expect(isWithinBusinessHours(at("21"), 20, 2)).toBe(true);
    expect(isWithinBusinessHours(at("01"), 20, 2)).toBe(true);
    expect(isWithinBusinessHours(at("03"), 20, 2)).toBe(false);
    expect(isWithinBusinessHours(at("12"), 20, 2)).toBe(false);
  });

  it("start sama dengan end = buka 24 jam", () => {
    expect(isWithinBusinessHours(at("03"), 0, 0)).toBe(true);
  });
});

describe("evaluateResponseSla", () => {
  const now = new Date("2026-07-20T10:30:00+07:00");

  it("null bila tidak ada yang menunggu", () => {
    expect(evaluateResponseSla(null, 15, now)).toBeNull();
  });

  it("belum lewat batas → tidak melanggar, sisa waktu dilaporkan", () => {
    const result = evaluateResponseSla("2026-07-20T10:25:00+07:00", 15, now);

    expect(result?.waitingSeconds).toBe(300);
    expect(result?.breached).toBe(false);
    expect(result?.remainingSeconds).toBe(600);
  });

  it("lewat batas → melanggar, sisa 0", () => {
    const result = evaluateResponseSla("2026-07-20T10:00:00+07:00", 15, now);

    expect(result?.waitingSeconds).toBe(1800);
    expect(result?.breached).toBe(true);
    expect(result?.remainingSeconds).toBe(0);
  });

  it("tepat di batas belum dianggap melanggar", () => {
    const result = evaluateResponseSla("2026-07-20T10:15:00+07:00", 15, now);
    expect(result?.breached).toBe(false);
  });

  it("tanggal tidak valid → null, bukan NaN", () => {
    expect(evaluateResponseSla("bukan-tanggal", 15, now)).toBeNull();
  });
});

describe("parseCsatReply", () => {
  it("angka 1-5 polos diterima", () => {
    expect(parseCsatReply("5")).toBe(5);
    expect(parseCsatReply(" 4 ")).toBe(4);
    expect(parseCsatReply("3.")).toBe(3);
    expect(parseCsatReply("nilai 5")).toBe(5);
  });

  it("angka di luar 1-5 ditolak", () => {
    expect(parseCsatReply("0")).toBeNull();
    expect(parseCsatReply("6")).toBeNull();
    expect(parseCsatReply("10")).toBeNull();
  });

  it("angka dalam kalimat panjang BUKAN skor CSAT", () => {
    expect(parseCsatReply("pesanan saya nomor 3 belum datang")).toBeNull();
    expect(parseCsatReply("saya sudah bayar 2 kali tapi belum masuk")).toBeNull();
  });

  it("kosong/null ditolak", () => {
    expect(parseCsatReply(null)).toBeNull();
    expect(parseCsatReply("")).toBeNull();
    expect(parseCsatReply("terima kasih")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("skala detik sampai hari", () => {
    expect(formatDuration(45)).toBe("45d");
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(3600)).toBe("1j");
    expect(formatDuration(8100)).toBe("2j 15m");
    expect(formatDuration(90000)).toBe("1h 1j");
  });

  it("nilai tidak valid → strip", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(-5)).toBe("-");
  });
});
