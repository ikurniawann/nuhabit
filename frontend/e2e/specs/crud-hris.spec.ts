import type { Page } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect, test } from "../support/fixtures";

/** Picks the first option of the Combobox whose trigger has the given id. */
async function pickFirst(page: Page, id: string) {
  await page.locator(`#${id}`).click();
  await page.getByRole("option").first().click();
}

test.describe("crud: HRIS department", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  test("creates, edits and deletes a department", async ({ page }) => {
    test.setTimeout(120_000);
    const name = uniqueName("Dept");
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);

    await page.goto("/dashboard/master/departments");
    await page.getByRole("button", { name: "Tambah Departemen" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nama Departemen").fill(name);
    await dialog.getByLabel("Kode").fill(code);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const search = page.getByPlaceholder("Cari nama atau kode...");
    await search.fill(code);
    const row = page.getByRole("row").filter({ hasText: code });
    await expect(row).toContainText(name);

    const renamed = `${name} edited`;
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog.getByLabel("Nama Departemen")).toHaveValue(name);
    await dialog.getByLabel("Nama Departemen").fill(renamed);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText(renamed);

    await row.getByRole("button", { name: "Hapus" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
    await expect(page.getByRole("row").filter({ hasText: code })).toHaveCount(0);
    await expect(page.getByText("Tidak ada departemen yang cocok")).toBeVisible();
  });

  test("rejects an empty name", async ({ page }) => {
    await page.goto("/dashboard/master/departments");
    await page.getByRole("button", { name: "Tambah Departemen" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kode").fill("E2EEMPTY");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Nama dan kode wajib diisi")).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe("crud: HRIS employee", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  test("creates and edits an employee", async ({ page }) => {
    test.setTimeout(120_000);
    const name = uniqueName("Employee");
    const email = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@nuhabit.test`;

    await page.goto("/dashboard/employees/insert");
    await page.getByLabel("Full Name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Join Date").fill("2026-01-05");
    await pickFirst(page, "employee-employment-status");
    await page.getByRole("button", { name: "Add Employee" }).click();
    await expect(page).toHaveURL(/\/dashboard\/employees\/[0-9a-f-]{36}$/, { timeout: 45_000 });
    const employeeId = page.url().split("/").pop()!;

    try {
      await page.goto("/dashboard/employees");
      await page.getByPlaceholder("Search name, employee ID, email...").fill(email);
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toHaveCount(1);

      await row.getByRole("button", { name: `Edit ${name}` }).click();
      await expect(page.getByLabel("Full Name")).toHaveValue(name, { timeout: 45_000 });
      await expect(page.getByLabel("Email")).toHaveValue(email);
      const renamed = `${name} edited`;
      await page.getByLabel("Full Name").fill(renamed);
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page).toHaveURL(`/dashboard/employees/${employeeId}`, { timeout: 45_000 });

      await page.goto("/dashboard/employees");
      await page.getByPlaceholder("Search name, employee ID, email...").fill(email);
      await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(1);
    } finally {
      // The directory has no delete or deactivate control; soft-delete through the API.
      await page.request.delete(`/api/hris/employees/${employeeId}`);
    }
  });

  test.skip("deactivates an employee through the dashboard", () => {
    // No UI: the employee form has no active toggle and the directory no delete button.
    // DELETE /api/hris/employees/{id} (soft delete) exists but nothing in the dashboard calls it.
  });

  test("rejects a missing full name", async ({ page }) => {
    await page.goto("/dashboard/employees/insert");
    await page.getByLabel("Email").fill("e2e-missing-name@nuhabit.test");
    await page.getByRole("button", { name: "Add Employee" }).click();
    await expect(page.getByText("Full name, email, join date, and employment status are required")).toBeVisible();
    await expect(page).toHaveURL("/dashboard/employees/insert");
  });
});
