import { describe, expect, it } from "vitest";
import type { SchemeRow } from "@/lib/gym/incentive-server";
import { initialSchemeForm, isSchemeFormValid, schemeFormReducer, toSchemeInput, usedClassTypes } from "./scheme-form";

const coachScheme: SchemeRow = {
  id: "sch-1",
  name: "Skema Rizky",
  coachId: "coach-1",
  coachName: "Rizky",
  isDefault: false,
  sessionFeeIdr: 200_000,
  perAttendeeIdr: 20_000,
  fullClassBonusIdr: 75_000,
  fullClassThresholdPercent: 90,
  noShowPenaltyIdr: 10_000,
  isActive: true,
  updatedAt: "2026-10-01T00:00:00Z",
  rates: [{ classTypeId: "ct-sim", sessionFeeIdr: 300_000, perAttendeeIdr: 25_000 }],
};

describe("initialSchemeForm", () => {
  it("skema baru memakai tarif default organisasi", () => {
    expect(initialSchemeForm(null)).toMatchObject({
      name: "",
      coach_id: "",
      session_fee_idr: "150000",
      per_attendee_idr: "15000",
      full_class_bonus_idr: "50000",
      full_class_threshold_percent: "80",
      no_show_penalty_idr: "0",
      is_active: true,
      rates: [],
    });
  });

  it("skema yang diubah: angka jadi teks input, tarif ikut", () => {
    const form = initialSchemeForm(coachScheme);
    expect(form.session_fee_idr).toBe("200000");
    expect(form.rates).toEqual([{ class_type_id: "ct-sim", session_fee_idr: "300000", per_attendee_idr: "25000" }]);
  });
});

describe("schemeFormReducer", () => {
  const start = initialSchemeForm(coachScheme);

  it("tarif baru mulai dari honor umum saat ini", () => {
    const edited = schemeFormReducer(start, { type: "field", key: "session_fee_idr", value: "180000" });
    const added = schemeFormReducer(edited, { type: "addRate" });
    expect(added.rates[1]).toEqual({ class_type_id: "", session_fee_idr: "180000", per_attendee_idr: "20000" });
  });

  it("ubah dan hapus baris tarif berdasarkan indeks", () => {
    const added = schemeFormReducer(start, { type: "addRate" });
    const patched = schemeFormReducer(added, { type: "rate", index: 1, patch: { class_type_id: "ct-eng" } });
    expect(usedClassTypes(patched)).toEqual(["ct-sim", "ct-eng"]);
    const removed = schemeFormReducer(patched, { type: "removeRate", index: 0 });
    expect(usedClassTypes(removed)).toEqual(["ct-eng"]);
  });

  it("toggle aktif tidak menyentuh kolom lain", () => {
    const next = schemeFormReducer(start, { type: "active", value: false });
    expect(next).toEqual({ ...start, is_active: false });
  });
});

describe("isSchemeFormValid", () => {
  const valid = initialSchemeForm(coachScheme);

  it("skema coach wajib memilih coach; default tidak", () => {
    const noCoach = { ...valid, coach_id: "" };
    expect(isSchemeFormValid(noCoach, false)).toBe(false);
    expect(isSchemeFormValid(noCoach, true)).toBe(true);
  });

  it("nama minimal 2 huruf dan ambang 0 s.d. 100", () => {
    expect(isSchemeFormValid({ ...valid, name: " A " }, false)).toBe(false);
    expect(isSchemeFormValid({ ...valid, full_class_threshold_percent: "101" }, false)).toBe(false);
    expect(isSchemeFormValid(valid, false)).toBe(true);
  });

  it("dua tarif untuk jenis kelas yang sama ditolak", () => {
    const dup = { ...valid, rates: [...valid.rates, { ...valid.rates[0]! }] };
    expect(isSchemeFormValid(dup, false)).toBe(false);
  });
});

describe("toSchemeInput", () => {
  it("angka kosong jadi 0, baris tanpa jenis kelas dibuang, nama dipangkas", () => {
    const form = {
      ...initialSchemeForm(coachScheme),
      name: "  Skema Rizky  ",
      no_show_penalty_idr: "",
      rates: [
        { class_type_id: "ct-sim", session_fee_idr: "300000", per_attendee_idr: "" },
        { class_type_id: "", session_fee_idr: "1", per_attendee_idr: "1" },
      ],
    };
    expect(toSchemeInput(form, "sch-1", false)).toEqual({
      id: "sch-1",
      name: "Skema Rizky",
      coach_id: "coach-1",
      session_fee_idr: 200_000,
      per_attendee_idr: 20_000,
      full_class_bonus_idr: 75_000,
      full_class_threshold_percent: 90,
      no_show_penalty_idr: 0,
      is_active: true,
      rates: [{ class_type_id: "ct-sim", session_fee_idr: 300_000, per_attendee_idr: 0 }],
    });
  });

  it("skema default tidak terikat coach", () => {
    expect(toSchemeInput(initialSchemeForm(coachScheme), "sch-1", true).coach_id).toBeNull();
  });
});
