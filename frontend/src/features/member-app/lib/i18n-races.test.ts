import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ID } from "./i18n";
import { RACES_ID } from "./i18n-races";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

describe("race screens dictionary", () => {
  const racesDir = path.resolve(__dirname, "../races");
  const keys = new Set<string>();
  for (const name of readdirSync(racesDir)) {
    const source = readFileSync(path.join(racesDir, name), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]!);
  }

  it("finds the screen copy to check", () => {
    expect(keys.size).toBeGreaterThan(80);
  });

  it("translates every key the race, result and leaderboard screens use", () => {
    expect([...keys].filter((key) => !(key in ID))).toEqual([]);
  });

  it("keeps placeholders identical between key and translation", () => {
    const mismatched = Object.entries(RACES_ID).filter(([en, id]) => placeholders(en) !== placeholders(id));
    expect(mismatched).toEqual([]);
  });
});
