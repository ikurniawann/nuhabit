import { auditRoute } from "../support/audit";
import { MEMBER_MISSING, MEMBER_STATE, STAFF_MISSING, STAFF_STATE, memberCredentials, staffCredentials } from "../support/auth";
import { test } from "../support/fixtures";
import { DASHBOARD_ROUTES, MEMBER_ROUTES, PUBLIC_ROUTES } from "../support/routes";

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
