import type { Locator, Page } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect as baseExpect, test } from "../support/fixtures";

// Each test walks several pages; a dev server compiles each on first visit.
const expect = baseExpect.configure({ timeout: 60_000 });

// CRUD through the purchasing pages: supplier and purchase request.
// /dashboard/purchasing/* redirects to the /dashboard/raw-material/purchasing/* sidebar paths.

const pickOption = async (page: Page, trigger: Locator, label?: string) => {
  await trigger.click();
  const options = page.getByRole("option");
  await (label ? options.filter({ hasText: label }).first() : options.first()).click();
};

const rowWith = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

const shortCode = () => `E${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

/** Confirms the open ConfirmDialog with its "Hapus" button. */
const confirmDelete = (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();

test.describe("purchasing CRUD", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  test.slow();

  test("supplier: create, list, edit, delete", async ({ page }) => {
    const name = uniqueName("Supplier");
    const renamed = `${name} Ubah`;

    await page.goto("/dashboard/purchasing/suppliers/insert");
    await page.locator("#nama").fill(name);
    await pickOption(page, page.locator("#kota"));
    await page.getByRole("button", { name: "Simpan Supplier" }).click();
    await expect(page.getByText("Supplier berhasil dibuat.")).toBeVisible();
    await expect(page).toHaveURL(/\/purchasing\/suppliers$/);

    const search = page.getByPlaceholder("Cari supplier...");
    await search.fill(name);
    await expect(rowWith(page, name)).toBeVisible();

    await rowWith(page, name).getByTitle("Ubah").click();
    await expect(page.locator("#nama")).toHaveValue(name);
    await page.locator("#nama").fill(renamed);
    await page.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(page.getByText("Supplier berhasil diperbarui.")).toBeVisible();
    await expect(page).toHaveURL(/\/purchasing\/suppliers$/);
    await search.fill(renamed);
    await expect(rowWith(page, renamed)).toBeVisible();

    await rowWith(page, renamed).getByTitle("Hapus").click();
    await confirmDelete(page);
    await expect(page.getByText(`Supplier "${renamed}" berhasil dihapus.`)).toBeVisible();
    await expect(rowWith(page, renamed)).toHaveCount(0);
  });

  test("supplier: missing city shows a required message", async ({ page }) => {
    await page.goto("/dashboard/purchasing/suppliers/insert");
    await page.locator("#nama").fill(uniqueName("Supplier"));
    await page.getByRole("button", { name: "Simpan Supplier" }).click();
    await expect(page.getByText("Nama supplier dan kota wajib diisi.")).toBeVisible();
    await expect(page).toHaveURL(/\/suppliers\/insert$/);
  });

  test("purchase request: create, list, edit", async ({ page }) => {
    // The seed has no raw materials, and a PR line must reference one: build the
    // chain (category, unit, raw material) through the item pages first.
    test.setTimeout(480_000);
    const tag = shortCode();
    const categoryCode = `E2E_${tag}`;
    const categoryName = uniqueName("Kategori Bahan");
    const unitName = uniqueName("Satuan PR");
    const materialName = uniqueName("Bahan PR");
    const notes = uniqueName("Catatan PR");
    const editedNotes = `${notes} Ubah`;

    await page.goto("/dashboard/raw-material/categories");
    await page.getByRole("button", { name: "Tambah Kategori" }).first().click();
    await page.getByRole("dialog").locator("#item-code").fill(categoryCode);
    await page.getByRole("dialog").locator("#item-nama").fill(categoryName);
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.goto("/dashboard/raw-material/units");
    await page.getByRole("button", { name: "Tambah Satuan" }).first().click();
    await page.getByRole("dialog").locator("#unit-kode").fill(tag);
    await page.getByRole("dialog").locator("#unit-nama").fill(unitName);
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Satuan berhasil ditambahkan")).toBeVisible();

    await page.goto("/dashboard/raw-material/materials/insert");
    await page.locator("#nama").fill(materialName);
    await pickOption(page, page.locator("#kategori"), categoryName);
    await pickOption(page, page.locator("#satuan_besar"), unitName);
    await page.getByRole("button", { name: "Simpan Bahan Baku" }).click();
    await expect(page.getByText("Bahan baku berhasil ditambahkan")).toBeVisible();

    // Create the PR as a draft and read its number from the API answer.
    await page.goto("/dashboard/purchasing/pr/insert");
    await pickOption(page, page.locator("#department_id"));
    await pickOption(page, page.locator("#pr-0-material"), materialName);
    await page.locator("#notes").fill(notes);
    const created = page.waitForResponse((r) => r.url().endsWith("/api/purchasing/pr") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Simpan Draf" }).click();
    const body = await (await created).json();
    expect(body.data?.id, JSON.stringify(body)).toBeTruthy();
    const prId: string = body.data.id;
    const prNumber: string = body.data.pr_number;
    await expect(page.getByText("Draf purchase request berhasil disimpan")).toBeVisible();

    await expect(page).toHaveURL(/\/purchasing\/pr$/);
    await page.getByPlaceholder("Cari nomor purchase request...").fill(prNumber);
    await expect(rowWith(page, prNumber)).toBeVisible();

    await rowWith(page, prNumber).getByTitle("Ubah").click();
    await expect(page.locator("#notes")).toHaveValue(notes);
    await page.locator("#notes").fill(editedNotes);
    await pickOption(page, page.locator("#priority"), "Mendesak");
    await page.getByRole("button", { name: "Simpan Perubahan" }).click();
    await expect(page).toHaveURL(new RegExp(`/purchasing/pr/${prId}`));
    await expect(page.getByText(editedNotes)).toBeVisible();

    await page.goto("/dashboard/purchasing/pr");
    await page.getByPlaceholder("Cari nomor purchase request...").fill(prNumber);
    await expect(rowWith(page, prNumber)).toContainText("Mendesak");

    // Clean up the setup chain; the draft PR itself has no delete (see the skipped test).
    await page.goto("/dashboard/raw-material/materials");
    await page.getByPlaceholder("Cari kode, nama, atau kategori...").fill(materialName);
    await rowWith(page, materialName).getByTitle("Hapus").click();
    await confirmDelete(page);
    await expect(page.getByText("Bahan baku berhasil dihapus.")).toBeVisible();

    await page.goto("/dashboard/raw-material/units");
    await page.getByPlaceholder("Cari kode atau nama...").fill(tag);
    // A unit still referenced by a (soft-deleted) raw material cannot be deleted, so deactivate it.
    await page.getByRole("switch", { name: `Ubah status aktif ${unitName}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Nonaktifkan" }).click();
    await expect(page.getByText("Satuan berhasil dinonaktifkan")).toBeVisible();

    await page.goto("/dashboard/raw-material/categories");
    await page.getByPlaceholder("Cari kode atau nama...").fill(categoryCode);
    await rowWith(page, categoryName).getByTitle("Hapus").click();
    await confirmDelete(page);
    await expect(rowWith(page, categoryName)).toHaveCount(0);
  });

  test("purchase request: delete", () => {
    test.skip(true, "No UI deletes or cancels a purchase request: list and detail offer only Detail, Ubah, Cetak and Buat PO, and the API has no DELETE route");
  });

  test("purchase request: missing department shows a required message", async ({ page }) => {
    await page.goto("/dashboard/purchasing/pr/insert");
    await page.getByRole("button", { name: "Simpan Draf" }).click();
    await expect(page.getByText("Departemen wajib diisi", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/pr\/insert$/);
  });
});
