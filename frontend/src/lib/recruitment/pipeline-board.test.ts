import { describe, expect, it } from "vitest";
import {
  daysInStage,
  filterBoardCandidates,
  funnelSegmentWidth,
  funnelTotal,
  groupByStage,
  initials,
  neighbourStages,
  stageAgeTone,
  stageDotClass,
} from "./pipeline-board";

const c = (over: Partial<Parameters<typeof filterBoardCandidates>[0][number]>) => ({
  id: "1",
  full_name: "Budi Santoso",
  email: "budi@mail.com",
  status: "applied",
  brand_id: "b1",
  updated_at: "2026-10-01T00:00:00Z",
  positions: { title: "Barista" },
  ...over,
});

describe("daysInStage & stageAgeTone", () => {
  it("membulatkan ke atas per 24 jam", () => {
    const now = Date.parse("2026-10-04T01:00:00Z");
    expect(daysInStage("2026-10-01T00:00:00Z", now)).toBe(4);
    expect(daysInStage("2026-10-04T01:00:00Z", now)).toBe(0);
  });

  it("> 7 hari kuning, > 14 hari merah", () => {
    expect(stageAgeTone(7)).toBe("fresh");
    expect(stageAgeTone(8)).toBe("aging");
    expect(stageAgeTone(15)).toBe("stale");
  });
});

describe("initials", () => {
  it("dua kata pertama, huruf besar", () => {
    expect(initials("budi santoso wijaya")).toBe("BS");
    expect(initials("Ani")).toBe("A");
  });
});

describe("filterBoardCandidates", () => {
  const list = [
    c({ id: "1" }),
    c({ id: "2", full_name: "Citra", email: null, brand_id: "b2", positions: { title: "Kasir" } }),
  ];

  it("filter brand, 'all' = semua", () => {
    expect(filterBoardCandidates(list, "all", "").map((x) => x.id)).toEqual(["1", "2"]);
    expect(filterBoardCandidates(list, "b2", "").map((x) => x.id)).toEqual(["2"]);
  });

  it("cari nama, email, atau posisi (case-insensitive)", () => {
    expect(filterBoardCandidates(list, "all", " KASIR ").map((x) => x.id)).toEqual(["2"]);
    expect(filterBoardCandidates(list, "all", "budi@").map((x) => x.id)).toEqual(["1"]);
    expect(filterBoardCandidates(list, "b1", "citra")).toEqual([]);
  });
});

describe("groupByStage & funnel", () => {
  it("semua tahap ada, status asing diabaikan", () => {
    const map = groupByStage([c({ status: "screening" }), c({ status: "talent_pool" }), c({ status: "archived" })]);
    expect(map.get("screening")).toHaveLength(1);
    expect(map.get("applied")).toEqual([]);
    expect(funnelTotal(map)).toBe(1);
  });

  it("lebar segmen: rata saat kosong, minimal 4% bila berisi", () => {
    expect(funnelSegmentWidth(0, 0)).toBeCloseTo(100 / 6);
    expect(funnelSegmentWidth(1, 100)).toBe(4);
    expect(funnelSegmentWidth(0, 100)).toBe(0);
    expect(funnelSegmentWidth(50, 100)).toBe(50);
  });
});

describe("neighbourStages", () => {
  it("prev/next di funnel, null di ujung & tahap parkir", () => {
    expect(neighbourStages("applied")).toEqual({ prev: null, next: "screening" });
    expect(neighbourStages("offer")).toEqual({ prev: "interview", next: "hired" });
    expect(neighbourStages("hired")).toEqual({ prev: "offer", next: null });
    expect(neighbourStages("rejected")).toEqual({ prev: null, next: null });
  });
});

it("stageDotClass menggelapkan warna badge", () => {
  expect(stageDotClass("bg-blue-100 text-blue-700")).toBe("bg-blue-400");
});
