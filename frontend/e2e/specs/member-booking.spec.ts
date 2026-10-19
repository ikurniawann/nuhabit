import type { APIRequestContext } from "@playwright/test";
import { MEMBER_MISSING, MEMBER_STATE, memberCredentials } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Projects run side by side with one member, so each books on its own day.
// Day 2 and later keeps the cancel ahead of the free-cancel deadline.
const DAY_OFFSET: Record<string, number> = { phone: 2, tablet: 3, desktop: 4 };

type BookingRow = { id: string; status: string; session_id: string };

/** Cancels the member's active booking of a session through the member API. */
async function cancelActiveBooking(request: APIRequestContext, sessionId: string) {
  const response = await request.get("/api/member-portal/gym/bookings");
  expect(response.ok(), "list bookings").toBeTruthy();
  const { data } = (await response.json()) as { data: BookingRow[] };
  for (const row of data.filter((b) => b.session_id === sessionId && ["confirmed", "waitlist"].includes(b.status))) {
    expect((await request.delete(`/api/member-portal/gym/bookings/${row.id}`)).ok(), "cancel booking").toBeTruthy();
  }
}

/** The schedule's day chip reads like "Wed21" in Asia/Jakarta, the app's zone. */
function dayChipName(offset: number) {
  const date = new Date(Date.now() + offset * 86_400_000);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", ...options }).format(date);
  return new RegExp(`^${part({ weekday: "short" })}\\s*${part({ day: "numeric" })}$`);
}

test.describe("member sign-in", () => {
  test.skip(!memberCredentials(), MEMBER_MISSING);

  // The API counts every sign-in per account (10 per 15 minutes), so only one project signs in through the form.
  test("signs in through the login form", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one form sign-in per run keeps the account under its rate limit");
    const { username, password } = memberCredentials()!;
    await page.goto("/member/auth/login?from=/member/classes");
    await page.getByLabel("WhatsApp number or email").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/member/classes");
    await expect(page.getByRole("heading", { name: "Classes" })).toBeVisible();
  });
});

test.describe("member books and cancels a class", () => {
  test.skip(!memberCredentials(), MEMBER_MISSING);
  test.use({ storageState: MEMBER_STATE });

  let sessionId = "";
  test.afterEach(async ({ page }) => {
    if (sessionId) await cancelActiveBooking(page.request, sessionId);
  });

  test("schedule, book with credits, see it in bookings, cancel", async ({ page }, testInfo) => {
    const offset = DAY_OFFSET[testInfo.project.name] ?? 2;

    await page.goto("/member/classes");
    await expect(page.getByRole("heading", { name: "Classes" })).toBeVisible();
    await page.getByRole("button", { name: dayChipName(offset) }).click();

    const openSession = page.locator('a[href^="/member/classes/"]').filter({ hasText: /\d+ left/ }).first();
    await expect(openSession, "a class with free seats on the chosen day").toBeVisible();
    const href = (await openSession.getAttribute("href"))!;
    sessionId = href.split("/").pop()!;
    await openSession.click();

    await expect(page).toHaveURL(href);
    await page.getByRole("button", { name: "Book this class" }).click();
    await expect(page.getByText("You're in! See you at the studio.")).toBeVisible();
    await expect(page.getByText("You're booked. Scan your QR at the gate to check in.")).toBeVisible();

    await page.getByRole("link", { name: /My bookings/ }).click();
    await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
    const booking = page.locator(`a[href="${href}"]`);
    await expect(booking).toBeVisible();
    await booking.click();

    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByText("Booking cancelled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Book this class" })).toBeVisible();
  });
});
