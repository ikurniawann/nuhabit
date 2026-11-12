import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect, test } from "../support/fixtures";

/**
 * CRM members have no create or delete control in the dashboard: profiles
 * come from POS customers and member sign-up, and "Aktifkan" only shows while
 * no CRM profile exists at all. The spec seeds one customer plus profile
 * through the API, then reads, edits and deactivates it through the UI.
 */
test.describe("crud: CRM member", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  test.skip("create through the dashboard", () => {
    // No dashboard form creates a CRM member; see the comment above.
  });

  test("lists, edits and deactivates a member", async ({ page }) => {
    test.setTimeout(120_000);
    const name = uniqueName("Member");
    const phone = `0899${Date.now().toString().slice(-8)}`;

    const customer = await page.request.post("/api/pos/customers", { data: { name, phone } });
    expect(customer.status(), await customer.text()).toBe(201);
    const customerId = (await customer.json()).data.id as string;
    const enrolled = await page.request.post("/api/crm/members", { data: { customer_id: customerId } });
    expect(enrolled.ok(), await enrolled.text()).toBe(true);

    await page.goto("/dashboard/crm/members");
    await page.getByPlaceholder("Cari nama, phone, email, kode member").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.getByRole("link", { name: "Detail" }).click();

    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible({ timeout: 45_000 });
    const form = page.locator("section").filter({ hasText: "Customer & Member Settings" });
    const nameInput = form.getByLabel("Nama");
    await expect(nameInput).toHaveValue(name);

    const renamed = `${name} edited`;
    await nameInput.fill(renamed);
    await form.getByLabel("Status Member").selectOption("inactive");
    await form.getByLabel("Customer aktif").uncheck();
    await form.getByRole("button", { name: "Simpan" }).click();
    await expect(form.getByText("Data member berhasil disimpan")).toBeVisible();
    await expect(page.getByRole("heading", { name: renamed, level: 2 })).toBeVisible();
    await expect(page.getByText("inactive", { exact: true })).toBeVisible();

    await page.goto("/dashboard/crm/members");
    await page.getByPlaceholder("Cari nama, phone, email, kode member").fill(renamed);
    await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(1);
  });

  test("shows a message when the name is empty", async ({ page }) => {
    await page.goto("/dashboard/crm/members");
    await page.getByRole("link", { name: "Detail" }).first().click();
    const form = page.locator("section").filter({ hasText: "Customer & Member Settings" });
    await form.getByLabel("Nama").fill("");
    await expect(form.getByRole("alert")).toHaveText("Nama wajib diisi sebelum menyimpan.");
    await expect(form.getByRole("button", { name: "Simpan" })).toBeDisabled();
  });
});
