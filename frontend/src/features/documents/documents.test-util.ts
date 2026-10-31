import axe from "axe-core";
import { expect } from "vitest";
import type { Letterhead } from "./api";

export const LETTERHEAD: Letterhead = {
  legal_name: "PT NüHabit Indonesia",
  address: "Jl. Merdeka 1",
  city: "Bandung",
  email: "halo@nuhabit.id",
  phone: "022-123",
  npwp: "01.234.567.8-901.000",
  website: null,
  logo_url: "/api/files/site/letterhead/logo.png",
  custom_logo: true,
};

/** Tidak ada pelanggaran axe WCAG 2 A/AA berdampak serius atau kritis. */
export async function expectAxeClean(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    // Warna dihitung dari token CSS yang tidak dimuat jsdom.
    rules: { "color-contrast": { enabled: false } },
  });
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}
