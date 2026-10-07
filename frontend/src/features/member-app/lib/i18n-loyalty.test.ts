import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ID } from "./i18n";
import { LOYALTY_ID } from "./i18n-loyalty";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

describe("loyalty screens dictionary", () => {
  const loyaltyDir = path.resolve(__dirname, "../loyalty");
  const files = [
    ...readdirSync(loyaltyDir).map((name) => path.join(loyaltyDir, name)),
    path.resolve(__dirname, "../components/pwa.tsx"),
    path.resolve(__dirname, "../components/bottom-sheet.tsx"),
    path.resolve(__dirname, "../profile/settings-page.tsx"),
    path.resolve(__dirname, "../profile/profile-page.tsx"),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  // Label lewat peta (t(LABELS[x])) dan helper murni, bukan literal t("...").
  const dynamic = [
    "Top-up",
    "Top-up bonus",
    "Payment",
    "Refund",
    "Bonus",
    "Expired",
    "Adjustment",
    "Reversal",
    "Top-up refund",
    "Balance withdrawal",
    "Waiting for pickup",
    "Approved",
    "Picked up",
    "Cancelled",
    "Rejected",
    "Limited",
    "Legendary",
    "Epic",
    "Rare",
    "Common",
    "Disappointed",
    "Not great",
    "Okay",
    "Happy",
    "Very happy",
    "Given by the team",
    "{n} visits",
    "Rp {n}",
    "{n}-week streak",
    "{n} XP",
    "ARK worth {amount}",
    "Minimum {amount}",
    "Maximum {amount}",
    "Could not turn on notifications",
    "Could not turn off notifications",
  ];

  it("finds the screen copy to check", () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it("translates every key the screens use", () => {
    expect([...keys, ...dynamic].filter((key) => !(key in ID))).toEqual([]);
  });

  it("keeps placeholders identical between key and translation", () => {
    const mismatched = Object.entries(LOYALTY_ID).filter(([en, id]) => placeholders(en) !== placeholders(id));
    expect(mismatched).toEqual([]);
  });
});
