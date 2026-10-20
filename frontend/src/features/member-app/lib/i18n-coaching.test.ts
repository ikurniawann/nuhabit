import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { METRICS } from "@/lib/gym/assessments";
import { ID } from "./i18n";
import { COACHING_ID } from "./i18n-coaching";
import { PT_STATUS } from "./queries-coaching";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

describe("coaching screens dictionary", () => {
  const dir = path.resolve(__dirname, "../coaching");
  const keys = new Set<string>([...METRICS.map((m) => m.labelEn), ...Object.values(PT_STATUS).map((s) => s.label)]);
  for (const name of readdirSync(dir)) {
    for (const match of readFileSync(path.join(dir, name), "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }

  it("translates every key the screens use", () => {
    expect(keys.size).toBeGreaterThan(40);
    expect([...keys].filter((key) => !(key in ID))).toEqual([]);
  });

  it("keeps placeholders identical between key and translation", () => {
    expect(Object.entries(COACHING_ID).filter(([en, id]) => placeholders(en) !== placeholders(id))).toEqual([]);
  });
});
