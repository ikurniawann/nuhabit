import type { Page } from "@playwright/test";
import { isAllowed } from "./allowlist";
import { horizontalOverflow, seriousViolations, settle, switchToDarkTheme } from "./checks";
import { expect } from "./fixtures";

/** Overflow and axe checks for the page as it is now; failures are soft so both themes report. */
async function auditTheme(page: Page, route: string, theme: string) {
  const overflow = await horizontalOverflow(page);
  expect.soft(overflow, `${theme}: page scrolls sideways (${JSON.stringify(overflow)})`).toBeNull();
  const violations = (await seriousViolations(page)).filter((v) => !isAllowed(v.id, route));
  expect.soft(violations, `${theme}: axe serious/critical violations`).toEqual([]);
}

/**
 * Opens a page and checks it in light and dark mode: HTTP status below 400,
 * no bounce to the sign-in page, no sideways scroll, no serious axe
 * violations. `allowlistKey` is the route the axe allowlist knows it by.
 */
export async function auditRoute(page: Page, url: string, signInPath?: RegExp, allowlistKey = url) {
  // settle() waits for the data; "load" can stall on a slow image and adds nothing here.
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 0, "HTTP status").toBeLessThan(400);
  await settle(page);
  if (signInPath) expect(page.url(), "the session reached the page").not.toMatch(signInPath);
  await auditTheme(page, allowlistKey, "light");
  await switchToDarkTheme(page);
  await settle(page);
  await auditTheme(page, allowlistKey, "dark");
}
