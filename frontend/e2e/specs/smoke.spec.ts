import type { Page } from "@playwright/test";
import { isAllowed } from "../support/allowlist";
import { MEMBER_MISSING, MEMBER_STATE, STAFF_MISSING, STAFF_STATE, memberCredentials, staffCredentials } from "../support/auth";
import { horizontalOverflow, seriousViolations, settle, switchToDarkTheme } from "../support/checks";
import { expect, test } from "../support/fixtures";
import { DASHBOARD_ROUTES, MEMBER_ROUTES, PUBLIC_ROUTES } from "../support/routes";

/** Overflow and axe checks for the page as it is now; failures are soft so both themes report. */
async function auditTheme(page: Page, route: string, theme: string) {
  const overflow = await horizontalOverflow(page);
  expect.soft(overflow, `${theme}: page scrolls sideways (${JSON.stringify(overflow)})`).toBeNull();
  const violations = (await seriousViolations(page)).filter((v) => !isAllowed(v.id, route));
  expect.soft(violations, `${theme}: axe serious/critical violations`).toEqual([]);
}

async function auditRoute(page: Page, route: string, signInPath?: RegExp) {
  // settle() waits for the data; "load" can stall on a slow image and adds nothing here.
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 0, "HTTP status").toBeLessThan(400);
  await settle(page);
  if (signInPath) expect(page.url(), "the session reached the page").not.toMatch(signInPath);
  await auditTheme(page, route, "light");
  await switchToDarkTheme(page);
  await settle(page);
  await auditTheme(page, route, "dark");
}

test.describe("public pages", () => {
  for (const route of PUBLIC_ROUTES) {
    test(route, async ({ page }) => auditRoute(page, route));
  }
});

test.describe("member pages", () => {
  test.skip(!memberCredentials(), MEMBER_MISSING);
  test.use({ storageState: MEMBER_STATE });
  for (const route of MEMBER_ROUTES) {
    test(route, async ({ page }) => auditRoute(page, route, /\/member\/auth\/login/));
  }
});

test.describe("dashboard pages", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  for (const route of DASHBOARD_ROUTES) {
    test(route, async ({ page }) => auditRoute(page, route, /\/login/));
  }
});
