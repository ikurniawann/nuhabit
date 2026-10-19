import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Violation = { id: string; impact: string; help: string; targets: string[] };

/**
 * Waits for the page to stop fetching. Pages that poll never go idle, so the
 * wait is bounded and a timeout is not a failure.
 */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** The page scrolls sideways when the document is wider than the viewport. */
export async function horizontalOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number } | null> {
  const size = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    clientWidth: document.documentElement.clientWidth,
  }));
  return size.scrollWidth > size.clientWidth + 1 ? size : null;
}

/** axe-core WCAG 2 A/AA violations with serious or critical impact. */
export async function seriousViolations(page: Page): Promise<Violation[]> {
  // evaluate() runs outside the page CSP, unlike an injected script tag.
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      resultTypes: ["violations"],
    });
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact ?? "",
        help: v.help,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      }));
  });
}

/** Switches the app to dark mode the way the theme toggle stores it, then reloads. */
export async function switchToDarkTheme(page: Page) {
  await page.evaluate(() => localStorage.setItem("arkiv-theme", JSON.stringify({ mode: "dark" })));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload({ waitUntil: "domcontentloaded" });
}
