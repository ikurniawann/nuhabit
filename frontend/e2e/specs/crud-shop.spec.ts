import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect as baseExpect, test } from "../support/fixtures";

// The dev server compiles pages on first hit; give each step room under load.
const expect = baseExpect.configure({ timeout: 60_000 });

test.describe("shop CRUD", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  // Each test is a whole create-to-delete journey against a dev server.
  test.setTimeout(300_000);

  test("storefront settings: save survives a reload, a bad number is refused", async ({ page }) => {
    await page.goto("/dashboard/shop/settings");
    await expect(page.getByRole("heading", { name: "Storefront Settings" })).toBeVisible();
    const headline = page.getByLabel("Judul banner");
    const whatsapp = page.getByLabel("Nomor WhatsApp toko");
    const save = page.getByRole("button", { name: "Simpan", exact: true });
    await expect(headline).toBeEditable();
    const original = await headline.inputValue();
    const changed = uniqueName("Banner");

    try {
      await headline.fill(changed);
      await save.click();
      await expect(page.getByText("Pengaturan storefront tersimpan")).toBeVisible();
      await page.reload();
      await expect(headline).toHaveValue(changed);

      // Validation: the settings have no required field; a malformed phone is the refusal case.
      const originalPhone = await whatsapp.inputValue();
      await whatsapp.fill("bukan-nomor");
      await save.click();
      await expect(page.locator("[data-sonner-toast][data-type=error]")).toBeVisible();
      await page.reload();
      await expect(whatsapp).toHaveValue(originalPhone);
    } finally {
      await page.reload();
      await headline.fill(original);
      if (original !== changed) {
        await save.click();
        await expect(page.getByText("Pengaturan storefront tersimpan").first()).toBeVisible();
      }
    }
    await page.reload();
    await expect(headline).toHaveValue(original);
  });

  test("storefront settings: create and delete", async () => {
    test.skip(true, "Storefront settings are a single row: the page only edits it, nothing is created or deleted");
  });

  test("promo code: create campaign with a public code, edit, delete the code, deactivate", async ({ page }) => {
    const name = uniqueName("Promo");
    const renamed = `${name} Ubah`;
    const code = `E2E${Date.now().toString(36).toUpperCase()}`;

    await page.goto("/dashboard/promo");
    await expect(page.getByRole("heading", { name: "Promo", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Buat Campaign" }).click();
    const dialog = page.getByRole("dialog");

    // Validation: leaving the name empty shows a message and keeps save disabled.
    await dialog.getByLabel("Nama Campaign").focus();
    await dialog.getByLabel("Persen").fill("10");
    await expect(dialog.getByText("Nama campaign wajib diisi, minimal 2 karakter.")).toBeVisible();

    await dialog.locator("#promo-code-mode").click();
    await page.getByRole("option", { name: "Satu kode publik" }).click();
    await dialog.getByLabel("Kode Publik").fill(code);
    await expect(dialog.getByRole("button", { name: "Buat Campaign" })).toBeDisabled();

    await dialog.getByLabel("Nama Campaign").fill(name);
    await expect(dialog.getByText("Nama campaign wajib diisi, minimal 2 karakter.")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Buat Campaign" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 kode");

    // Update: rename; the edit form opens prefilled.
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog.getByLabel("Nama Campaign")).toHaveValue(name);
    await dialog.getByLabel("Nama Campaign").fill(renamed);
    await dialog.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(dialog).toBeHidden();
    const renamedRow = page.getByRole("row").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible();

    // Delete: the unused public code goes from Kode & Riwayat.
    await renamedRow.getByRole("button", { name: "Kode & Riwayat" }).click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByText(code, { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Hapus kode" }).click();
    await expect(detail.getByText(code, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(renamedRow).toContainText("0 kode");

    // Deactivate the campaign itself; campaigns have no delete.
    const active = renamedRow.getByRole("switch", { name: `Aktifkan ${renamed}` });
    await expect(active).toBeChecked();
    await active.click();
    await expect(active).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: renamed }).getByRole("switch", { name: `Aktifkan ${renamed}` })).not.toBeChecked();
  });
});
