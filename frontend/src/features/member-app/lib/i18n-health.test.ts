import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, PARQ_REQUIRED } from "./error-codes";
import { ID } from "./i18n";
import { answersComplete, answersPayload, initialAnswers, parqBanner, PARQ_QUESTIONS, questionText, type ParqStatus } from "./parq";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const CODES = ["heart_condition", "chest_pain", "dizziness", "chronic_condition", "medication", "bone_joint", "supervised_only"];

const status = (over: Partial<ParqStatus> = {}): ParqStatus => ({
  version: "parq-plus-2026",
  questions: CODES.map((code) => ({ code })),
  due: true,
  last: null,
  ...over,
});

const declaration = {
  id: "d1",
  version: "parq-plus-2026",
  answers: Object.fromEntries(CODES.map((c) => [c, c === "bone_joint"])),
  has_yes: true,
  details: "lutut",
  submitted_at: "2026-01-10T03:00:00Z",
  expires_at: "2027-01-10T03:00:00Z",
};

describe("health declaration dictionary", () => {
  const keys = new Set<string>();
  for (const file of ["../profile/health-page.tsx", "../profile/health-card.tsx", "../home/health-banner.tsx"]) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  // Keys passed through a variable: the questions, the denial link and the error code text.
  const all = [...keys, ...Object.values(PARQ_QUESTIONS), "Fill in the health declaration", ERROR_MESSAGES[PARQ_REQUIRED]];

  it("translates every key with the same placeholders", () => {
    expect(all.filter((key) => !(key in ID))).toEqual([]);
    expect(all.filter((key) => key in ID && placeholders(ID[key]) !== placeholders(key))).toEqual([]);
  });

  it("words every PAR-Q+ question the server asks", () => {
    expect(Object.keys(PARQ_QUESTIONS).sort()).toEqual([...CODES].sort());
    expect(questionText("unknown_code")).toBe("unknown_code");
  });
});

describe("PAR-Q helpers", () => {
  it("needs a yes or no for every question", () => {
    const answers = Object.fromEntries(CODES.map((c) => [c, false]));
    expect(answersComplete(answers, status())).toBe(true);
    expect(answersComplete({ ...answers, medication: undefined }, status())).toBe(false);
    expect(answersPayload({ chest_pain: true }, status())).toEqual(Object.fromEntries(CODES.map((c) => [c, c === "chest_pain"])));
  });

  it("asks to fill or refill on the home screen", () => {
    expect(parqBanner(undefined)).toBeNull();
    expect(parqBanner(status())).toBe("fill");
    expect(parqBanner(status({ last: declaration }))).toBe("refill");
    expect(parqBanner(status({ due: false, last: declaration }))).toBeNull();
  });

  it("starts a due declaration empty and a current one from its answers", () => {
    expect(initialAnswers(status({ last: declaration }))).toEqual({});
    expect(initialAnswers(status({ due: false, last: declaration }))).toEqual(declaration.answers);
  });
});
