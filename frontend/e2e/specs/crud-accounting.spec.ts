import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect, test } from "../support/fixtures";

test.describe("crud: chart of accounts", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  test("creates, edits and deletes an account", async ({ page }) => {
    test.setTimeout(120_000);
    const name = uniqueName("Akun");
    // Compact 7-digit code in the 9xxxxxx range, away from the 1-8 account classes.
    const code = `9${String(Date.now() % 1_000_000).padStart(6, "0")}`;

    await page.goto("/dashboard/accounting/chart-of-accounts");
    await page.getByRole("button", { name: "Tambah Akun", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kode").fill(code);
    // Pick the type: a dialog opened before the type list loads starts blank.
    await dialog.locator("#coa-account-type").click();
    await page.getByRole("option", { name: /^ASSET/ }).click();
    await dialog.getByLabel("Nama").fill(name);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const search = page.getByPlaceholder("Cari kode / nama...");
    await search.fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);

    const renamed = `${name} edited`;
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog.getByLabel("Nama")).toHaveValue(name);
    await dialog.getByLabel("Nama").fill(renamed);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await search.fill(renamed);
    const renamedRow = page.getByRole("row").filter({ hasText: renamed });
    await expect(renamedRow).toHaveCount(1);

    await renamedRow.getByRole("button", { name: "Hapus" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
    await expect(page.getByText("Akun berhasil dihapus")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(0);
  });

  test("blocks saving without a code", async ({ page }) => {
    await page.goto("/dashboard/accounting/chart-of-accounts");
    await page.getByRole("button", { name: "Tambah Akun", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nama").fill("E2E tanpa kode");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeVisible();
    // The browser's required-field bubble is the visible message here.
    const message = await dialog.getByLabel("Kode").evaluate((input: HTMLInputElement) => input.validationMessage);
    expect(message).not.toBe("");
  });
});
