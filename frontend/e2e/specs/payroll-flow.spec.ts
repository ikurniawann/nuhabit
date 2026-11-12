import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { DB_MISSING, closeDatabase, firstRow, hasDatabase } from "../support/db";
import { expect, test } from "../support/fixtures";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * Payroll run end to end: create a run for a free far-future period,
 * calculate it for the seeded employees with an active salary, open the run
 * and one payslip, then delete the run so the period is free again.
 */
test.describe("payroll", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.skip(!hasDatabase(), DB_MISSING);
  test.use({ storageState: STAFF_STATE });
  test.afterAll(closeDatabase);

  test("creates and calculates a run, then shows a payslip", async ({ page }) => {
    const salaried = await firstRow<{ full_name: string }>(
      `select e.full_name from hris.employee_salary s join hris.employees e on e.id = s.employee_id
        where s.is_active order by e.full_name limit 1`
    );
    test.skip(!salaried, "no employee with an active salary structure in this database");

    // A random free period between 2040 and 2098 keeps parallel runs and reruns apart.
    let month = 0;
    let year = 0;
    for (let attempt = 0; attempt < 20 && !year; attempt++) {
      const m = 1 + Math.floor(Math.random() * 12);
      const y = 2040 + Math.floor(Math.random() * 59);
      const taken = await firstRow("select 1 from hris.payroll_runs where period_month = $1 and period_year = $2", [m, y]);
      if (!taken) [month, year] = [m, y];
    }
    expect(year, "found a free payroll period").toBeGreaterThan(0);
    const period = `${MONTHS[month - 1]} ${year}`;

    await page.goto("/dashboard/hris/payroll");
    await expect(page.getByRole("heading", { name: "Payroll & Benefits" })).toBeVisible();

    await page.getByRole("button", { name: "Payroll Baru" }).click();
    const dialog = page.getByRole("dialog", { name: "Buat Payroll Baru" });
    await dialog.getByRole("combobox", { name: "Bulan" }).click();
    await page.getByRole("option", { name: MONTHS[month - 1], exact: true }).click();
    await dialog.getByRole("spinbutton", { name: "Tahun" }).fill(String(year));
    await dialog.getByRole("button", { name: "Buat Payroll" }).click();
    await expect(page.getByText("Payroll run berhasil dibuat")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: period });
    await expect(row).toContainText("Draft");

    await row.getByRole("button", { name: "Calculate" }).click();
    await page.getByRole("dialog", { name: "Konfirmasi Perhitungan Payroll" }).getByRole("button", { name: "Hitung Payroll" }).click();
    const result = page.getByRole("dialog", { name: "Hasil Perhitungan" });
    await expect(result.getByText("Perhitungan Berhasil!")).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(salaried!.full_name);
    await result.getByRole("button", { name: "Tutup" }).click();
    await expect(row).not.toContainText("Rp 0");

    try {
      await row.getByRole("button", { name: "Lihat detail payroll" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Payroll ${period}`);
      const slipRow = page.getByRole("row").filter({ hasText: salaried!.full_name });
      await slipRow.getByRole("button", { name: "Slip" }).click();
      await expect(page).toHaveURL(/\/dashboard\/hris\/payroll\/[^/]+\/payslip\/[^/]+$/);
      await expect(page.getByRole("heading", { name: "Slip Gaji" })).toBeVisible();
      await expect(page.getByText(salaried!.full_name).first()).toBeVisible();
      await expect(page.getByText("Take Home Pay (Gaji Bersih)")).toBeVisible();
    } finally {
      await page.goto("/dashboard/hris/payroll");
      await page.getByRole("row").filter({ hasText: period }).getByRole("button", { name: "Hapus" }).click();
      await page.getByRole("button", { name: "Hapus payroll" }).click();
      await expect(page.getByText("Payroll run berhasil dihapus")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: period })).toHaveCount(0);
    }
  });
});
