import { describe, expect, it } from "vitest";
import {
  formatSplit,
  leaderboardParams,
  parseResultsPaste,
  parseSplit,
  splitLabel,
  splitsTotal,
} from "./hyrox-results";

describe("parseSplit", () => {
  it("reads m:ss, mm:ss and h:mm:ss", () => {
    expect(parseSplit("4:12")).toBe(252);
    expect(parseSplit(" 04:12 ")).toBe(252);
    expect(parseSplit("75:30")).toBe(4530);
    expect(parseSplit("1:04:12")).toBe(3852);
  });
  it("reads digits typed on a number pad", () => {
    expect(parseSplit("412")).toBe(252);
    expect(parseSplit("1230")).toBe(750);
    expect(parseSplit("10412")).toBe(3852);
    expect(parseSplit("011233")).toBe(4353);
  });
  it("rejects junk, zero and out-of-range parts", () => {
    for (const bad of ["", "4", "12", "4:7", "4:60", "475", "1:60:00", "0:00", "000", "abc", "4:12:"]) {
      expect(parseSplit(bad)).toBeNull();
    }
  });
});

describe("formatSplit", () => {
  it("round-trips with parseSplit", () => {
    expect(formatSplit(252)).toBe("4:12");
    expect(formatSplit(3852)).toBe("1:04:12");
    expect(formatSplit(null)).toBe("");
    expect(parseSplit(formatSplit(4530))).toBe(4530);
  });
});

describe("splitsTotal", () => {
  const eight = (sec: number) => Array<number | null>(8).fill(sec);
  it("sums 16 splits and Roxzone", () => {
    expect(splitsTotal(eight(300), eight(240), 120)).toBe(4440);
    expect(splitsTotal(eight(300), eight(240), null)).toBe(4320);
  });
  it("is null until every run and station is entered", () => {
    const stations = eight(240);
    stations[3] = null;
    expect(splitsTotal(eight(300), stations, 120)).toBeNull();
  });
});

describe("splitLabel", () => {
  it("names runs, stations and the total", () => {
    expect(splitLabel("run3")).toBe("Run 3");
    expect(splitLabel("station1")).toBe("SkiErg");
    expect(splitLabel("station8")).toBe("Wall Balls");
    expect(splitLabel("total")).toBe("Total");
  });
});

describe("parseResultsPaste", () => {
  it("places labeled lines on their split", () => {
    const pasted = [
      "Running 1  00:04:05",
      "1000m SkiErg  00:04:30",
      "Running 2 4:10",
      "50m Sled Push 3:05",
      "Sled Pull 4:40",
      "80m Burpee Broad Jumps 5:01",
      "Rowing 4:35",
      "Farmers Carry 1:50",
      "Sandbag Lunges 4:20",
      "Wall Balls 6:12",
      "Roxzone 7:45",
      "Overall Time 1:22:33",
    ].join("\n");
    const got = parseResultsPaste(pasted);
    expect(got.runs.slice(0, 2)).toEqual([245, 250]);
    expect(got.runs[2]).toBeNull();
    expect(got.stations).toEqual([270, 185, 280, 301, 275, 110, 260, 372]);
    expect(got.roxzone).toBe(465);
    expect(got.total).toBe(4953);
  });
  it("takes unlabeled times in race order, then Roxzone and total", () => {
    const times = Array.from({ length: 16 }, (_, i) => `${4 + (i % 2)}:0${i % 10}`);
    const got = parseResultsPaste([...times, "7:00", "1:20:00"].join("\n"));
    expect(got.runs[0]).toBe(240);
    expect(got.stations[0]).toBe(301);
    expect(got.runs[7]).toBe(244);
    expect(got.stations[7]).toBe(305);
    expect(got.roxzone).toBe(420);
    expect(got.total).toBe(4800);
  });
  it("ignores lines without a time", () => {
    expect(parseResultsPaste("Rank 12\nDivision Men Open").runs.every((v) => v === null)).toBe(true);
  });
});

describe("leaderboardParams", () => {
  it("sends only the filters that are set", () => {
    expect(leaderboardParams({}).toString()).toBe("");
    expect(
      leaderboardParams({ raceId: "r", division: "MEN_OPEN", ageGroup: "30-34", year: 2026, includeUnverified: true, station: 2 }).toString()
    ).toBe("race_id=r&division=MEN_OPEN&age_group=30-34&year=2026&include_unverified=true&station=2");
  });
});
