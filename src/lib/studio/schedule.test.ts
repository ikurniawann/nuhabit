import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetweenInclusive,
  eachDate,
  expandTemplates,
  findCoachConflicts,
  hhmm,
  isoWeekday,
  isValidDate,
  isValidTime,
  startOfWeek,
  timesOverlap,
  type TemplateSlot,
} from "./schedule";

const slot = (over: Partial<TemplateSlot>): TemplateSlot => ({
  id: "t1",
  weekday: 1,
  start_time: "17:00:00",
  end_time: "18:00:00",
  program_id: "p1",
  coach_id: "c1",
  capacity: 12,
  is_active: true,
  ...over,
});

describe("tanggal & jam", () => {
  it("menghitung hari ISO (Senin=1, Minggu=7)", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // Senin
    expect(isoWeekday("2026-10-04")).toBe(7); // Minggu
    expect(isoWeekday("2026-10-03")).toBe(6);
  });

  it("menemukan Senin awal minggu", () => {
    expect(startOfWeek("2026-10-08")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-04")).toBe("2026-09-28"); // Minggu ikut minggu sebelumnya
  });

  it("menambah hari melewati batas bulan & tahun", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("memvalidasi tanggal dan jam", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-10-05")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("06:30")).toBe(true);
    expect(hhmm("06:30:00")).toBe("06:30");
  });

  it("menghasilkan rentang tanggal inklusif dan kosong bila terbalik", () => {
    expect(eachDate("2026-10-05", "2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(eachDate("2026-10-07", "2026-10-05")).toEqual([]);
    expect(daysBetweenInclusive("2026-10-01", "2026-10-31")).toBe(31);
  });

  it("mendeteksi jam tumpang tindih tetapi tidak untuk slot bersambung", () => {
    expect(timesOverlap("17:00", "18:00", "17:30", "18:30")).toBe(true);
    expect(timesOverlap("17:00", "18:00", "18:00", "19:00")).toBe(false);
  });
});

describe("expandTemplates", () => {
  it("membuat sesi untuk hari yang cocok dalam rentang", () => {
    const templates = [slot({ id: "mon", weekday: 1 }), slot({ id: "sun", weekday: 7, start_time: "07:00", end_time: "08:00" })];
    const out = expandTemplates(templates, "2026-10-04", "2026-10-11");
    expect(out.map((s) => `${s.template_id}@${s.session_date}`)).toEqual([
      "sun@2026-10-04",
      "mon@2026-10-05",
      "sun@2026-10-11",
    ]);
    expect(out[1].start_time).toBe("17:00");
  });

  it("melewati template nonaktif, sesi yang sudah ada, dan hari libur", () => {
    const templates = [slot({ id: "a" }), slot({ id: "b", is_active: false })];
    const out = expandTemplates(
      templates,
      "2026-10-05",
      "2026-10-19",
      new Set(["a|2026-10-05"]),
      new Set(["2026-10-12"])
    );
    expect(out.map((s) => s.session_date)).toEqual(["2026-10-19"]);
  });

  it("menghasilkan 39 kelas per minggu untuk skema Nuhabit (6 kelas Sen–Sab, 3 Minggu pagi)", () => {
    const times = [
      ["06:00", "07:00"], ["07:00", "08:00"], ["08:00", "09:00"],
      ["17:00", "18:00"], ["18:00", "19:00"], ["19:00", "20:00"],
    ];
    const templates: TemplateSlot[] = [];
    for (let day = 1; day <= 6; day++)
      times.forEach(([s, e], i) => templates.push(slot({ id: `d${day}-${i}`, weekday: day, start_time: s, end_time: e })));
    times.slice(0, 3).forEach(([s, e], i) => templates.push(slot({ id: `d7-${i}`, weekday: 7, start_time: s, end_time: e })));
    expect(expandTemplates(templates, "2026-10-05", "2026-10-11")).toHaveLength(39);
  });
});

describe("findCoachConflicts", () => {
  const others = [
    { id: "s1", coach_id: "c1", session_date: "2026-10-05", start_time: "17:00", end_time: "18:00" },
    { id: "s2", coach_id: "c2", session_date: "2026-10-05", start_time: "17:00", end_time: "18:00" },
    { id: "s3", coach_id: "c1", session_date: "2026-10-06", start_time: "17:00", end_time: "18:00" },
  ];

  it("menemukan sesi coach yang sama di tanggal & jam yang bertabrakan", () => {
    const hits = findCoachConflicts({ coach_id: "c1", session_date: "2026-10-05", start_time: "17:30", end_time: "18:30" }, others);
    expect(hits.map((h) => h.id)).toEqual(["s1"]);
  });

  it("mengabaikan dirinya sendiri dan sesi tanpa coach", () => {
    expect(findCoachConflicts({ id: "s1", coach_id: "c1", session_date: "2026-10-05", start_time: "17:00", end_time: "18:00" }, others)).toEqual([]);
    expect(findCoachConflicts({ coach_id: null, session_date: "2026-10-05", start_time: "17:00", end_time: "18:00" }, others)).toEqual([]);
  });

  it("memeriksa template berdasarkan hari", () => {
    const templates = [{ id: "t1", coach_id: "c1", weekday: 2, start_time: "06:00", end_time: "07:00" }];
    expect(findCoachConflicts({ coach_id: "c1", weekday: 2, start_time: "06:30", end_time: "07:30" }, templates)).toHaveLength(1);
    expect(findCoachConflicts({ coach_id: "c1", weekday: 3, start_time: "06:30", end_time: "07:30" }, templates)).toHaveLength(0);
  });
});
