import { randomBytes } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect as baseExpect, test } from "../support/fixtures";

// The dev server compiles pages on first hit; give each step room under load.
const expect = baseExpect.configure({ timeout: 60_000 });

/** Opens a Combobox (Popover + cmdk) by its trigger and picks the option with this label. */
async function pick(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).first().click();
}

test.describe("configuration CRUD", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  // Each test is a whole create-to-delete journey against a dev server.
  test.setTimeout(300_000);

  test("user account: create login, change role, revoke access", async ({ page }) => {
    const name = uniqueName("Akun");
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@nuhabit.test`;

    // An account belongs to an employee; the employee itself is HRIS scope, so it is seeded over the API.
    const created = await page.request.post("/api/users", {
      data: { full_name: name, email, join_date: "2026-01-05", employment_status: "permanent" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const employeeId: string = (await created.json()).data.id;

    try {
      await page.goto("/dashboard/settings/users");
      await expect(page.getByRole("heading", { name: "Manajemen User" })).toBeVisible();
      await page.getByPlaceholder("Search name, employee ID, email...").fill(name);
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toBeVisible();
      await expect(row).toContainText("None");

      await row.getByRole("button", { name: `Buat akun login ${name}` }).click();
      const dialog = page.getByRole("dialog");

      // Validation: an empty password is refused with a visible message.
      await dialog.getByLabel("Password").fill("");
      await dialog.getByRole("button", { name: "Buat Akun" }).click();
      await expect(page.getByText("Password minimal 8 karakter")).toBeVisible();

      await dialog.getByLabel("Password").fill(`T${randomBytes(9).toString("base64url")}!9`);
      await pick(page, dialog.locator("#create-account-role"), "Admin");
      await pick(page, dialog.locator("[id$=\"-scope\"]"), "Holding");
      await pick(page, dialog.locator("[id$=\"-holding\"]"), "Prologe");
      await dialog.getByRole("button", { name: "Buat Akun" }).click();
      await expect(dialog.getByText(`Akun untuk ${name} berhasil dibuat`)).toBeVisible();
      await dialog.getByRole("button", { name: "Tutup" }).click();
      await expect(row).toContainText("Admin");

      // Update: change the role on the employee edit page.
      await row.getByRole("button", { name: `Edit ${name}` }).click();
      await expect(page.getByRole("heading", { name: "Edit Employee" })).toBeVisible();
      await expect(page.locator("#user-access-role")).toContainText("Admin");
      await pick(page, page.locator("#user-access-role"), "HRD");
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/employees/${employeeId}$`));

      await page.goto("/dashboard/settings/users");
      await page.getByPlaceholder("Search name, employee ID, email...").fill(name);
      await expect(row).toContainText("HRD");

      // Deactivate: turn login access off; the row falls back to "None".
      await row.getByRole("button", { name: `Edit ${name}` }).click();
      await page.getByRole("checkbox", { name: "Enable NüHabit login access" }).click();
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/employees/${employeeId}$`));

      await page.goto("/dashboard/settings/users");
      await page.getByPlaceholder("Search name, employee ID, email...").fill(name);
      await expect(row).toContainText("None");
      await expect(row.getByRole("button", { name: `Reset password ${name}` })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/hris/employees/${employeeId}`);
    }
  });

  test("role: create, grant a menu, rename, delete", async ({ page }) => {
    const name = uniqueName("Role");
    const renamed = `${name} Ubah`;

    await page.goto("/dashboard/settings/roles");
    await expect(page.getByRole("heading", { name: "Role & Permission" })).toBeVisible();

    await page.getByRole("button", { name: "Add Role" }).click();
    const dialog = page.getByRole("dialog");

    // Validation: Role Name is required; the browser blocks submit and explains why.
    await dialog.getByRole("button", { name: "Add Role" }).click();
    const nameInput = dialog.getByLabel("Role Name");
    await expect(nameInput).toHaveJSProperty("validity.valueMissing", true);
    expect(await nameInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe("");
    await expect(dialog).toBeVisible();

    await nameInput.fill(name);
    await dialog.getByRole("button", { name: "Add Role" }).click();
    await expect(page.getByText("Role added successfully")).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("Search name, code, or description...").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // Permissions: grant one menu and see it on the detail panel.
    await row.getByRole("button", { name: `Manage permissions for ${name}` }).click();
    const perms = page.getByRole("dialog");
    await perms.getByPlaceholder("Cari nama atau kode menu...").fill("promo");
    const firstMenu = perms.getByRole("checkbox").first();
    await firstMenu.click();
    await expect(firstMenu).toBeChecked();
    await perms.getByRole("button", { name: "Simpan Permissions" }).click();
    await expect(page.getByText("Permissions updated successfully")).toBeVisible();
    await expect(perms).toBeHidden();

    await row.getByRole("button", { name: `View details for ${name}` }).click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByText(/^[1-9]\d* menus$/).last()).toBeVisible();
    await expect(detail.getByText("No menu permissions assigned yet.")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();

    // Update: rename, the edit form opens prefilled.
    await row.getByRole("button", { name: `Edit ${name}` }).click();
    await expect(dialog.getByLabel("Role Name")).toHaveValue(name);
    await dialog.getByLabel("Role Name").fill(renamed);
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Role updated successfully")).toBeVisible();
    await page.getByPlaceholder("Search name, code, or description...").fill(renamed);
    const renamedRow = page.getByRole("row").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible();

    // Delete.
    await renamedRow.getByRole("button", { name: `Delete ${renamed}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Role deleted successfully")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(0);
  });
});
