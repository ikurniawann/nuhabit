import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} HTTP status`).toBe(200);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("public site", () => {
  test("home renders its hero", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("link", { name: /NüHabit/i }).first()).toBeVisible();
  });

  for (const path of ["/training", "/training/timetable", "/training/coaches", "/training/stations", "/training/faq", "/training/block"]) {
    test(`training page ${path}`, async ({ page }) => open(page, path));
  }

  test("locations list links to a branch page", async ({ page }) => {
    await open(page, "/locations");
    const branch = page.locator('main a[href^="/locations/"]').first();
    const href = await branch.getAttribute("href");
    expect(href, "a branch link").toMatch(/^\/locations\/[^/]+$/);
    await branch.click();
    await expect(page).toHaveURL(href!);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("training links to a class page", async ({ page }) => {
    await open(page, "/training");
    const classLink = page.locator('a[href^="/training/classes/"]').first();
    const href = await classLink.getAttribute("href");
    expect(href, "a class link").toMatch(/^\/training\/classes\/[^/]+$/);
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });
});
