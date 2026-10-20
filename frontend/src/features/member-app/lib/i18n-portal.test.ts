import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ID } from "./i18n";

// Screens and shared pieces whose copy goes through t("...") literals.
const FILES = [
  "../components/app-layout.tsx",
  "../components/route-map.tsx",
  "../auth/register-page.tsx",
  "../home/promo-detail-page.tsx",
  "../wallet/topup-page.tsx",
  "../profile/waiver-page.tsx",
  "../classes/session-detail-page.tsx",
];

describe("member portal dictionary", () => {
  const keys = new Set<string>();
  for (const file of FILES) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  // Keys passed through a variable: register steps, promo scopes, geolocation errors.
  const dynamic = [
    "Contact",
    "Verify",
    "Personal",
    "Emergency",
    "Waiver",
    "Male",
    "Female",
    "All purchases",
    "In-store purchases",
    "Online tickets",
    "Box office tickets",
    "Class packages",
    "Could not read your location.",
    "Could not read that image.",
  ];

  it("translates every key these screens use", () => {
    expect([...keys, ...dynamic].filter((key) => !(key in ID))).toEqual([]);
  });
});
