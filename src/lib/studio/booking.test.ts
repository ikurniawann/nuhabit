import { describe, expect, it } from "vitest";
import {
  checkBookingWindow,
  checkCheckinWindow,
  classifyCancel,
  DEFAULT_SETTINGS,
  finalStatus,
  pickPass,
  seatsTaken,
  sessionEpoch,
  waitlistOrder,
} from "./booking";

const at = (iso: string) => new Date(iso).getTime();

describe("waktu venue", () => {
  it("menghitung epoch sesi dalam WIB", () => {
    expect(sessionEpoch("2026-10-05", "17:00")).toBe(at("2026-10-05T10:00:00Z"));
  });
});

describe("classifyCancel", () => {
  const start = sessionEpoch("2026-10-05", "17:00");
  it("≥ 12 jam sebelum mulai → kredit kembali", () => {
    expect(classifyCancel(at("2026-10-04T22:00:00Z"), start, 12)).toBe("in_time"); // tepat 12 jam
    expect(classifyCancel(at("2026-10-04T22:00:01Z"), start, 12)).toBe("late");
  });
});

describe("checkBookingWindow", () => {
  const s = { session_date: "2026-10-05", start_time: "17:00", status: "scheduled" };
  it("menolak kelas yang batal, sudah mulai, atau terlalu jauh", () => {
    expect(checkBookingWindow({ ...s, status: "cancelled" }, at("2026-10-05T00:00:00Z"), DEFAULT_SETTINGS).ok).toBe(false);
    expect(checkBookingWindow(s, at("2026-10-05T10:00:00Z"), DEFAULT_SETTINGS).ok).toBe(false);
    expect(checkBookingWindow(s, at("2026-09-27T00:00:00Z"), DEFAULT_SETTINGS).ok).toBe(false); // > 7 hari
    expect(checkBookingWindow(s, at("2026-10-01T00:00:00Z"), DEFAULT_SETTINGS).ok).toBe(true);
  });

  it("staf boleh booking walk-in setelah kelas mulai", () => {
    expect(checkBookingWindow(s, at("2026-10-05T10:15:00Z"), DEFAULT_SETTINGS, true).ok).toBe(true);
  });

  it("menghormati batas tutup booking", () => {
    const st = { ...DEFAULT_SETTINGS, booking_close_minutes: 30 };
    expect(checkBookingWindow(s, at("2026-10-05T09:45:00Z"), st).ok).toBe(false);
  });
});

describe("pickPass", () => {
  const base = { status: "active", valid_from: "2026-10-01", pt_left: 0, breakage_recognized: false };
  const passes = [
    { ...base, id: "late", valid_until: "2026-10-30", class_left: 5 },
    { ...base, id: "soon", valid_until: "2026-10-10", class_left: 2 },
    { ...base, id: "empty", valid_until: "2026-10-08", class_left: 0 },
    { ...base, id: "future", valid_from: "2026-10-20", valid_until: "2026-11-20", class_left: 7 },
  ];

  it("memilih pass berlaku yang paling cepat berakhir dan masih ada kredit", () => {
    expect(pickPass(passes, "2026-10-05")?.id).toBe("soon");
    expect(pickPass(passes, "2026-10-15")?.id).toBe("late");
    expect(pickPass(passes, "2026-11-25")).toBeNull();
  });

  it("melewati pass yang revenue-nya sudah diakui (kedaluwarsa)", () => {
    expect(pickPass([{ ...passes[1], breakage_recognized: true }], "2026-10-05")).toBeNull();
  });
});

describe("kursi, waitlist & penyelesaian", () => {
  it("hanya booked & attended yang menempati kursi", () => {
    expect(seatsTaken([{ status: "booked" }, { status: "attended" }, { status: "waitlisted" }, { status: "cancelled" }])).toBe(2);
  });

  it("waitlist berurutan siapa cepat dia dapat", () => {
    const order = waitlistOrder([
      { id: "b", status: "waitlisted" as const, waitlisted_at: "2026-10-02T10:00:00Z", booked_at: "2026-10-02T10:00:00Z" },
      { id: "a", status: "waitlisted" as const, waitlisted_at: "2026-10-02T09:00:00Z", booked_at: "2026-10-02T09:00:00Z" },
      { id: "x", status: "booked" as const, waitlisted_at: null, booked_at: "2026-10-01T09:00:00Z" },
    ]);
    expect(order.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("booking yang tidak check-in jadi no-show saat kelas diselesaikan", () => {
    expect(finalStatus("booked")).toBe("no_show");
    expect(finalStatus("attended")).toBe("attended");
  });

  it("check-in dibuka 60 menit sebelum kelas", () => {
    const s = { session_date: "2026-10-05", start_time: "17:00", end_time: "18:00" };
    expect(checkCheckinWindow(s, at("2026-10-05T08:30:00Z"), DEFAULT_SETTINGS).ok).toBe(false);
    expect(checkCheckinWindow(s, at("2026-10-05T09:15:00Z"), DEFAULT_SETTINGS).ok).toBe(true);
  });
});
