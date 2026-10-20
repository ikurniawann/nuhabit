import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { expect, test } from "../support/fixtures";

const PAGES = [
  { path: "/dashboard", heading: "Ringkasan Eksekutif" },
  { path: "/dashboard/pos", heading: "POS Dashboard" },
  { path: "/dashboard/crm/members", heading: "Members" },
  { path: "/dashboard/gym/schedule", heading: "Jadwal Kelas" },
  { path: "/dashboard/gym/members", heading: "Member" },
  { path: "/dashboard/gym/reports", heading: "Laporan Gym" },
];

test.describe("staff dashboard", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);

  test("signs in through the login form", async ({ page }) => {
    const { email, password } = staffCredentials()!;
    await page.goto("/login?redirect=/dashboard");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Ringkasan Eksekutif" })).toBeVisible();
  });
});

test.describe("staff dashboard pages", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  for (const { path, heading } of PAGES) {
    test(`opens ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), "HTTP status").toBe(200);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await expect(page).toHaveURL(path);
    });
  }
});
