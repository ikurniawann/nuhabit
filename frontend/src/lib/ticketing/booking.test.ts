import { describe, expect, test } from "vitest";
import {
  BOOKING_MAX_DAYS_AHEAD,
  canTransitionBooking,
  generateAccessToken,
  generateBookingCode,
  buildGuestNames,
  isForfeitDue,
  matchRedeemGuests,
  normalizeBookingCode,
  redeemWindowStatus,
  validateVisitDateWindow,
  visitDateWindowError,
} from "./booking";

describe("canTransitionBooking (mesin status booking)", () => {
  test("menunggu-bayar boleh ke terbayar / kedaluwarsa / dibatalkan", () => {
    expect(canTransitionBooking("menunggu-bayar", "terbayar")).toBe(true);
    expect(canTransitionBooking("menunggu-bayar", "kedaluwarsa")).toBe(true);
    expect(canTransitionBooking("menunggu-bayar", "dibatalkan")).toBe(true);
  });

  test("terbayar hanya boleh ke digunakan / dibatalkan / hangus", () => {
    expect(canTransitionBooking("terbayar", "digunakan")).toBe(true);
    expect(canTransitionBooking("terbayar", "dibatalkan")).toBe(true);
    expect(canTransitionBooking("terbayar", "hangus")).toBe(true);
    expect(canTransitionBooking("terbayar", "kedaluwarsa")).toBe(false);
    expect(canTransitionBooking("terbayar", "menunggu-bayar")).toBe(false);
  });

  test("status terminal tidak bisa pindah ke mana pun (hangus TIDAK dibangkitkan)", () => {
    for (const terminal of [
      "digunakan",
      "kedaluwarsa",
      "dibatalkan",
      "hangus",
    ] as const) {
      for (const to of [
        "menunggu-bayar",
        "terbayar",
        "digunakan",
        "kedaluwarsa",
        "dibatalkan",
        "hangus",
      ] as const) {
        expect(canTransitionBooking(terminal, to)).toBe(false);
      }
    }
  });

  test("transisi ke status yang sama ditolak (idempotensi di lapisan atas)", () => {
    expect(canTransitionBooking("menunggu-bayar", "menunggu-bayar")).toBe(false);
  });
});

describe("generateBookingCode", () => {
  test("format BK-XXXXXX dengan charset anti-ambigu (tanpa 0/O/1/I/L)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBookingCode();
      expect(code).toMatch(/^BK-[2-9A-HJ-NP-Z]{6}$/);
    }
  });

  test("dua panggilan menghasilkan kode berbeda (probabilistik)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateBookingCode()));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe("generateAccessToken", () => {
  test("64 karakter hex dan unik antar panggilan", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("validateVisitDateWindow", () => {
  const today = "2026-07-22";

  test("hari ini dan besok sah", () => {
    expect(validateVisitDateWindow("2026-07-22", today)).toBe("ok");
    expect(validateVisitDateWindow("2026-07-23", today)).toBe("ok");
  });

  test("tanggal lampau ditolak", () => {
    expect(validateVisitDateWindow("2026-07-21", today)).toBe("masa-lalu");
  });

  test("tepat di batas maks hari ke depan masih sah, lewat satu hari ditolak", () => {
    expect(validateVisitDateWindow("2026-10-20", today)).toBe("ok"); // +90
    expect(validateVisitDateWindow("2026-10-21", today)).toBe("terlalu-jauh");
    expect(BOOKING_MAX_DAYS_AHEAD).toBe(90);
  });

  test("tanggal bukan kalender sungguhan ditolak", () => {
    expect(validateVisitDateWindow("2026-02-30", today)).toBe("tidak-valid");
    expect(validateVisitDateWindow("22-07-2026", today)).toBe("tidak-valid");
  });
});

describe("normalizeBookingCode", () => {
  test("hasil generate selalu lolos normalisasi apa adanya", () => {
    const code = generateBookingCode();
    expect(normalizeBookingCode(code)).toBe(code);
  });

  test("huruf kecil dan spasi dinormalkan", () => {
    expect(normalizeBookingCode("  bk-abcdef ")).toBe("BK-ABCDEF");
  });

  test("prefix BK- yang tertinggal ditambahkan", () => {
    expect(normalizeBookingCode("ABCDEF")).toBe("BK-ABCDEF");
    expect(normalizeBookingCode("bkabcdef")).toBe("BK-ABCDEF");
  });

  test("charset ambigu / panjang salah ditolak", () => {
    expect(normalizeBookingCode("BK-ABC10I")).toBeNull(); // 0/1/I terlarang
    expect(normalizeBookingCode("BK-ABCDE")).toBeNull();
    expect(normalizeBookingCode("")).toBeNull();
  });
});

describe("buildGuestNames (nama anggota rombongan + default)", () => {
  test("tanpa input → posisi 1 = pemesan, sisanya Group {nama} - N", () => {
    expect(buildGuestNames("Ilham", 3)).toEqual([
      "Ilham",
      "Group Ilham - 2",
      "Group Ilham - 3",
    ]);
  });

  test("nama yang diisi dipakai, yang kosong/null diisi default", () => {
    expect(buildGuestNames("Ilham", 4, ["", "Budi", null, "  "])).toEqual([
      "Ilham",
      "Budi",
      "Group Ilham - 3",
      "Group Ilham - 4",
    ]);
  });

  test("input di-trim dan dipotong ke batas kolom", () => {
    const long = "x".repeat(200);
    const result = buildGuestNames("Ilham", 1, [`  ${long}  `]);
    expect(result[0]).toBe(long.slice(0, 120));
  });

  test("qty 1 tanpa input = nama pemesan saja", () => {
    expect(buildGuestNames("  Ilham  ", 1)).toEqual(["Ilham"]);
  });
});

describe("matchRedeemGuests (pairing gelang \u2194 anggota rombongan)", () => {
  const guests = ["g1", "g2", "g3"];

  test("semua guest dapat tepat satu gelang → ok", () => {
    expect(
      matchRedeemGuests(guests, [
        { guest_id: "g2" },
        { guest_id: "g1" },
        { guest_id: "g3" },
      ])
    ).toEqual({ ok: true });
  });

  test("guest di luar booking ditolak", () => {
    expect(
      matchRedeemGuests(guests, [{ guest_id: "g1" }, { guest_id: "asing" }])
    ).toEqual({ ok: false, reason: "guest-asing", guest_id: "asing" });
  });

  test("satu guest dipasang dua gelang ditolak", () => {
    expect(
      matchRedeemGuests(guests, [
        { guest_id: "g1" },
        { guest_id: "g1" },
        { guest_id: "g2" },
      ])
    ).toEqual({ ok: false, reason: "guest-dobel", guest_id: "g1" });
  });

  test("ada guest belum dapat gelang ditolak dengan penunjuk guest-nya", () => {
    expect(
      matchRedeemGuests(guests, [{ guest_id: "g1" }, { guest_id: "g2" }])
    ).toEqual({ ok: false, reason: "belum-lengkap", guest_id: "g3" });
  });

  test("degenerate: tanpa guest tanpa gelang → ok", () => {
    expect(matchRedeemGuests([], [])).toEqual({ ok: true });
  });
});

describe("redeemWindowStatus & isForfeitDue (kebijakan hangus, owner 2026-07-23)", () => {
  test("kebijakan NULL = perilaku lama: hanya hari-H, tidak pernah hangus", () => {
    expect(redeemWindowStatus("2026-07-23", "2026-07-22", null)).toBe("belum-mulai");
    expect(redeemWindowStatus("2026-07-23", "2026-07-23", null)).toBe("boleh");
    expect(redeemWindowStatus("2026-07-23", "2026-07-24", null)).toBe("lewat");
    expect(isForfeitDue("2026-07-23", "2030-01-01", null)).toBe(false);
  });

  test("N=0: hanya hari-H, besoknya hangus", () => {
    expect(redeemWindowStatus("2026-07-23", "2026-07-23", 0)).toBe("boleh");
    expect(redeemWindowStatus("2026-07-23", "2026-07-24", 0)).toBe("lewat");
    expect(isForfeitDue("2026-07-23", "2026-07-24", 0)).toBe(true);
  });

  test("N=7: masa tenggang inklusif s/d H+7, H+8 hangus (lintas bulan aman)", () => {
    expect(redeemWindowStatus("2026-07-28", "2026-08-04", 7)).toBe("boleh");
    expect(redeemWindowStatus("2026-07-28", "2026-08-05", 7)).toBe("lewat");
    expect(isForfeitDue("2026-07-28", "2026-08-04", 7)).toBe(false);
    expect(isForfeitDue("2026-07-28", "2026-08-05", 7)).toBe(true);
  });

  test("belum hari-H tidak pernah dianggap hangus walau kebijakan aktif", () => {
    expect(redeemWindowStatus("2026-08-01", "2026-07-23", 0)).toBe("belum-mulai");
    expect(isForfeitDue("2026-08-01", "2026-07-23", 0)).toBe(false);
  });
});

describe("visitDateWindowError (pesan jendela tanggal booking)", () => {
  const today = "2026-10-04";

  test("tanggal dalam jendela → null", () => {
    expect(visitDateWindowError("2026-10-04", today)).toBeNull();
  });

  test("tiap penolakan punya pesan Indonesia", () => {
    expect(visitDateWindowError("2026-10-03", today)).toBe("Tanggal kunjungan sudah lewat");
    expect(visitDateWindowError("2027-10-04", today)).toBe("Tanggal kunjungan terlalu jauh ke depan");
    expect(visitDateWindowError("2026-02-30", today)).toBe("Tanggal kunjungan tidak valid");
  });
});
