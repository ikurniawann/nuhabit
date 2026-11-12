import type { Page } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { uniqueName } from "../support/crud";
import { expect as baseExpect, test } from "../support/fixtures";

// Dev-mode route compiles and saves under parallel suites routinely pass ten seconds.
const expect = baseExpect.configure({ timeout: 30_000 });

const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });
const dialog = (page: Page) => page.getByRole("dialog");

/** Monday of the current week in Asia/Jakarta, as a UTC-midnight Date. */
function wibMonday(): Date {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
}

test.describe("gym CRUD", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });
  test.describe.configure({ timeout: 180_000 });

  test("class type: create, edit, archive", async ({ page }) => {
    const name = uniqueName("Class");
    const renamed = `${name} v2`;
    await page.goto("/dashboard/gym/class-types");

    await page.getByRole("button", { name: "Jenis kelas baru" }).click();
    await dialog(page).getByLabel("Nama").fill(name);
    await dialog(page).getByLabel("Durasi (menit)").fill("45");
    await dialog(page).getByRole("button", { name: "Simpan" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toContainText("45 mnt");

    await row(page, name).getByRole("button", { name: "Ubah" }).click();
    await expect(dialog(page).getByLabel("Nama")).toHaveValue(name);
    await expect(dialog(page).getByLabel("Durasi (menit)")).toHaveValue("45");
    await dialog(page).getByLabel("Nama").fill(renamed);
    await dialog(page).getByLabel("Kapasitas").fill("9");
    await dialog(page).getByRole("button", { name: "Simpan" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, renamed)).toContainText("9");

    await row(page, renamed).getByRole("button", { name: "Arsipkan" }).click();
    await dialog(page).getByRole("button", { name: "Arsipkan" }).click();
    await expect(page.getByText("Jenis kelas diarsipkan")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row(page, renamed)).toContainText("Arsip");
    await expect(row(page, renamed).getByRole("button", { name: "Arsipkan" })).toHaveCount(0);
  });

  test("class type: name is required", async ({ page }) => {
    await page.goto("/dashboard/gym/class-types");
    await page.getByRole("button", { name: "Jenis kelas baru" }).click();
    const nameInput = dialog(page).getByLabel("Nama");
    await expect(nameInput).toHaveValue("");
    await expect(nameInput).toHaveJSProperty("validity.valueMissing", true);
    await expect(dialog(page).getByRole("button", { name: "Simpan" })).toBeDisabled();
  });

  test("coach: create, edit, deactivate", async ({ page }) => {
    const name = uniqueName("Coach");
    const renamed = `${name} v2`;
    await page.goto("/dashboard/gym/coaches");

    await page.getByRole("button", { name: "Coach baru" }).click();
    await dialog(page).getByLabel("Nama").fill(name);
    await dialog(page).getByLabel("Spesialisasi").fill("Sled push");
    await dialog(page).getByRole("button", { name: "Simpan" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toContainText("Sled push");

    await row(page, name).getByRole("button", { name: "Ubah" }).click();
    await expect(dialog(page).getByLabel("Nama")).toHaveValue(name);
    await expect(dialog(page).getByLabel("Spesialisasi")).toHaveValue("Sled push");
    await dialog(page).getByLabel("Nama").fill(renamed);
    await dialog(page).getByLabel("Spesialisasi").fill("Wall balls");
    await dialog(page).getByRole("button", { name: "Simpan" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, renamed)).toContainText("Wall balls");

    // Coaches have no delete; deactivating is the removal path.
    await row(page, renamed).getByRole("button", { name: "Ubah" }).click();
    await dialog(page).getByLabel("Status").selectOption("inactive");
    await dialog(page).getByRole("button", { name: "Simpan" }).click();
    await expect(dialog(page)).toBeHidden();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row(page, renamed)).toContainText("Nonaktif");
  });

  test("coach: name is required", async ({ page }) => {
    await page.goto("/dashboard/gym/coaches");
    await page.getByRole("button", { name: "Coach baru" }).click();
    await dialog(page).getByLabel("Spesialisasi").fill("No name");
    await expect(dialog(page).getByLabel("Nama")).toHaveJSProperty("validity.valueMissing", true);
    await expect(dialog(page).getByRole("button", { name: "Simpan" })).toBeDisabled();
  });

  test("credit package: create, edit, delete", async ({ page }) => {
    const name = uniqueName("Pack");
    const renamed = `${name} v2`;
    await page.goto("/dashboard/gym/packages");

    await page.getByRole("button", { name: "Paket baru" }).click();
    await dialog(page).getByLabel("Nama paket").fill(name);
    await dialog(page).getByLabel("Jumlah kredit").fill("5");
    await dialog(page).getByLabel("Harga dasar (Rp)").fill("250000");
    await dialog(page).getByLabel("Masa berlaku (hari)").fill("30");
    await dialog(page).getByRole("button", { name: "Buat paket" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toContainText("30 hari");
    await expect(row(page, name)).toContainText("250.000");

    await row(page, name).getByRole("button", { name: "Ubah" }).click();
    await expect(dialog(page).getByLabel("Nama paket")).toHaveValue(name);
    await expect(dialog(page).getByLabel("Harga dasar (Rp)")).toHaveValue("250000");
    await dialog(page).getByLabel("Nama paket").fill(renamed);
    await dialog(page).getByLabel("Harga dasar (Rp)").fill("300000");
    await dialog(page).getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, renamed)).toContainText("300.000");

    await row(page, renamed).getByRole("button", { name: "Hapus" }).click();
    await dialog(page).getByRole("button", { name: "Hapus paket" }).click();
    await expect(page.getByText("Paket dihapus")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(row(page, renamed)).toHaveCount(0);
  });

  test("credit package: name is required", async ({ page }) => {
    await page.goto("/dashboard/gym/packages");
    await page.getByRole("button", { name: "Paket baru" }).click();
    await expect(dialog(page).getByLabel("Nama paket")).toHaveJSProperty("validity.valueMissing", true);
    await expect(dialog(page).getByRole("button", { name: "Buat paket" })).toBeDisabled();
  });

  test("class session: create draft, edit, delete", async ({ page }) => {
    const classType = uniqueName("Session class");
    const coach = uniqueName("Session coach");
    const area = uniqueName("Rig");
    const typeRes = await page.request.post("/api/gym/class-types", {
      data: { name: classType, description: "", default_duration_min: 60, default_credit_cost: 1, default_capacity: 10, color: "lime", status: "active" },
    });
    expect(typeRes.ok(), await typeRes.text()).toBe(true);
    const typeId = (await typeRes.json()).data.id as string;
    const coachInput = { name: coach, specialization: "", bio: "", photo_url: null, status: "active", branch_id: null, user_id: null };
    const coachRes = await page.request.post("/api/gym/coaches", { data: coachInput });
    expect(coachRes.ok(), await coachRes.text()).toBe(true);
    const coachId = (await coachRes.json()).data.id as string;

    // Five weeks ahead, on a Wednesday, clear of the demo schedule.
    const weeksAhead = 5;
    const day = wibMonday();
    day.setUTCDate(day.getUTCDate() + weeksAhead * 7 + 2);
    const isoDay = day.toISOString().slice(0, 10);
    const openWeek = async () => {
      await page.goto("/dashboard/gym/schedule");
      for (let i = 0; i < weeksAhead; i++) await page.getByRole("button", { name: "Minggu berikutnya" }).click();
      await expect(page.getByRole("button", { name: `Sesi baru ${isoDay}` })).toBeVisible();
    };

    let sessionId: string | undefined;
    try {
      await openWeek();
      await page.getByRole("button", { name: `Sesi baru ${isoDay}` }).click();
      await dialog(page).getByLabel("Jenis kelas").selectOption({ label: `${classType} · 60 mnt · 1 kredit` });
      await dialog(page).getByLabel("Coach").selectOption({ label: coach });
      await expect(dialog(page).getByLabel("Tanggal")).toHaveValue(isoDay);
      // A unique area keeps reruns clear of the room clash check on leftover drafts.
      await dialog(page).getByLabel("Area").fill(area);
      await dialog(page).getByLabel(/Jam mulai/).fill("06:15");
      await dialog(page).getByRole("button", { name: "Simpan draf" }).click();
      await expect(dialog(page)).toBeHidden();

      const tile = page.getByRole("link").filter({ hasText: classType });
      await expect(tile).toContainText(coach);
      await expect(tile).toContainText("Draf");
      await tile.click();
      await expect(page).toHaveURL(/\/dashboard\/gym\/sessions\/[0-9a-f-]{36}$/);
      sessionId = page.url().split("/").pop();
          await expect(page.getByRole("heading", { name: classType })).toBeVisible();

      await page.getByRole("button", { name: "Ubah" }).click();
      await expect(dialog(page).getByLabel("Jenis kelas")).toHaveValue(typeId);
      await expect(dialog(page).getByLabel("Coach")).toHaveValue(coachId);
      await expect(dialog(page).getByLabel(/Jam mulai/)).toHaveValue("06:15");
      await dialog(page).getByLabel("Area").fill(`${area} B`);
      await dialog(page).getByLabel("Kapasitas").fill("7");
      await dialog(page).getByRole("button", { name: "Simpan perubahan" }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(page.getByText(`${area} B`).first()).toBeVisible();
      await expect(page.getByText("/ 7")).toBeVisible();

      await page.getByRole("button", { name: "Hapus" }).click();
      await dialog(page).getByRole("button", { name: "Hapus sesi" }).click();
      await expect(page).toHaveURL("/dashboard/gym/schedule");
      await openWeek();
      await expect(page.getByRole("link").filter({ hasText: classType })).toHaveCount(0);
      sessionId = undefined;
    } finally {
      if (sessionId) await page.request.delete(`/api/gym/sessions/${sessionId}`);
      await page.request.delete(`/api/gym/class-types/${typeId}`);
      await page.request.patch(`/api/gym/coaches/${coachId}`, { data: { ...coachInput, status: "inactive" } });
    }
  });

  test("class session: class type is required", async ({ page }) => {
    await page.goto("/dashboard/gym/schedule");
    await page.getByRole("button", { name: "Sesi baru", exact: true }).click();
    await expect(dialog(page).getByLabel("Jenis kelas")).toHaveValue("");
    await expect(dialog(page).getByLabel("Jenis kelas")).toHaveJSProperty("validity.valueMissing", true);
    await expect(dialog(page).getByRole("button", { name: "Terbitkan" })).toBeDisabled();
    await expect(dialog(page).getByRole("button", { name: "Simpan draf" })).toBeDisabled();
  });
});
