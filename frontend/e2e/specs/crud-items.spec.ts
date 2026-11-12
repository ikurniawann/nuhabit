import type { Locator, Page } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect as baseExpect, test } from "../support/fixtures";

// Each test walks several pages; a dev server compiles each on first visit.
const expect = baseExpect.configure({ timeout: 30_000 });

// CRUD through the item master pages: product, category and unit.
// URLs are the sidebar paths; next.config.ts rewrites them to /dashboard/items/*.

const pickOption = async (page: Page, trigger: Locator, label?: string) => {
  await trigger.click();
  const options = page.getByRole("option");
  await (label ? options.filter({ hasText: label }).first() : options.first()).click();
};

const rowWith = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

/** A short uppercase code that fits the 10-character unit code column. */
const shortCode = () => `E${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

/** Creates a unit through the units page; the seed ships none and products need one. */
async function createUnit(page: Page, code: string, name: string) {
  await page.goto("/dashboard/product/units");
  await page.getByRole("button", { name: "Tambah Satuan" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#unit-kode").fill(code);
  await dialog.locator("#unit-nama").fill(name);
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Satuan berhasil ditambahkan")).toBeVisible();
}

async function deleteUnit(page: Page, code: string) {
  await page.goto("/dashboard/product/units");
  await page.getByPlaceholder("Cari kode atau nama...").fill(code);
  await rowWith(page, code).getByTitle("Hapus").click();
  await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
  await expect(page.getByText("Satuan berhasil dihapus")).toBeVisible();
  await expect(rowWith(page, code)).toHaveCount(0);
}

test.describe("items CRUD", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  test.slow();

  test("unit: create, list, edit, delete", async ({ page }) => {
    const code = shortCode();
    const name = uniqueName("Satuan");
    const renamed = `${name} Ubah`;

    await createUnit(page, code, name);
    const dialog = page.getByRole("dialog");
    const search = page.getByPlaceholder("Cari kode atau nama...");
    await search.fill(code);
    await expect(rowWith(page, name)).toBeVisible();

    await rowWith(page, name).getByTitle("Ubah").click();
    await expect(dialog.locator("#unit-nama")).toHaveValue(name);
    await dialog.locator("#unit-nama").fill(renamed);
    await dialog.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(page.getByText("Satuan berhasil diperbarui")).toBeVisible();
    await expect(rowWith(page, renamed)).toBeVisible();

    await deleteUnit(page, code);
  });

  test("unit: blank name shows a required message", async ({ page }) => {
    await page.goto("/dashboard/product/units");
    await page.getByRole("button", { name: "Tambah Satuan" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#unit-kode").fill(shortCode());
    // Spaces pass the native required check and reach the form's own validation.
    await dialog.locator("#unit-nama").fill("   ");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Nama satuan wajib diisi")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("category: create, list, edit, delete", async ({ page }) => {
    const code = `E2E_${shortCode()}`;
    const name = uniqueName("Kategori");
    const renamed = `${name} Ubah`;

    await page.goto("/dashboard/product/categories");
    await page.getByRole("button", { name: "Tambah Kategori" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#item-code").fill(code);
    await dialog.locator("#item-nama").fill(name);
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(dialog).toBeHidden();

    const search = page.getByPlaceholder("Cari kode atau nama...");
    await search.fill(code);
    await expect(rowWith(page, name)).toBeVisible();

    await rowWith(page, name).getByTitle("Ubah").click();
    await expect(dialog.locator("#item-nama")).toHaveValue(name);
    await dialog.locator("#item-nama").fill(renamed);
    await dialog.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(dialog).toBeHidden();
    await expect(rowWith(page, renamed)).toBeVisible();

    await rowWith(page, renamed).getByTitle("Hapus").click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
    await expect(rowWith(page, code)).toHaveCount(0);
  });

  test("category: blank name shows a required message", async ({ page }) => {
    await page.goto("/dashboard/product/categories");
    await page.getByRole("button", { name: "Tambah Kategori" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#item-code").fill(`E2E_${shortCode()}`);
    await dialog.locator("#item-nama").fill("   ");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText(/nama.*wajib/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("product: create, list, edit, delete", async ({ page }) => {
    const name = uniqueName("Produk");
    const renamed = `${name} Ubah`;
    const unitCode = shortCode();
    const unitName = uniqueName("Satuan Produk");
    await createUnit(page, unitCode, unitName);

    await page.goto("/dashboard/product/products/insert");
    await page.locator("#nama").fill(name);
    await pickOption(page, page.locator("#satuan_id"), unitName);
    await page.getByRole("button", { name: "Simpan Produk" }).click();
    await expect(page.getByText("Produk berhasil ditambahkan")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/product\/products$/);

    const search = page.getByPlaceholder("Cari kode atau nama produk...");
    await search.fill(name);
    await expect(rowWith(page, name)).toBeVisible();

    await rowWith(page, name).getByTitle("Ubah produk").click();
    await expect(page.locator("#nama")).toHaveValue(name);
    await page.locator("#nama").fill(renamed);
    await page.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(page.getByText("Produk berhasil diperbarui")).toBeVisible();

    await page.goto("/dashboard/product/products");
    await search.fill(renamed);
    await expect(rowWith(page, renamed)).toBeVisible();

    await rowWith(page, renamed).getByTitle("Hapus produk").click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
    await expect(page.getByText("Produk berhasil dihapus.")).toBeVisible();
    await expect(rowWith(page, renamed)).toHaveCount(0);

    await deleteUnit(page, unitCode);
  });

  test("product: missing unit shows a required message", async ({ page }) => {
    await page.goto("/dashboard/product/products/insert");
    await page.locator("#nama").fill(uniqueName("Produk"));
    await page.getByRole("button", { name: "Simpan Produk" }).click();
    await expect(page.getByText("Satuan wajib diisi")).toBeVisible();
    await expect(page).toHaveURL(/\/products\/insert$/);
  });

  test("brand", () => {
    test.skip(true, "No brand entity exists: no table, API route or dashboard page for brands");
  });
});
