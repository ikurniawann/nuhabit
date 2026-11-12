import type { APIRequestContext } from "@playwright/test";
import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { expect, test } from "../support/fixtures";

/** Two postable accounts the spec owns; created once and reused, since posted lines keep them. */
const CASH = { code: "1101901", name: "E2E Kas Jurnal Manual", type: "ASSET", is_cash_bank: true };
const EQUITY = { code: "3101901", name: "E2E Modal Jurnal Manual", type: "EQUITY", is_cash_bank: false };

type Account = { id: string; code: string; name: string };

const jakartaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${response.url()} answered ${response.status()}: ${body.slice(0, 300)}`).toBe(true);
  return JSON.parse(body) as T;
}

type Coverage = { ready: boolean; suggestion: { can_open: boolean; period: { id: string } } | null };
const coverage = async (api: APIRequestContext, today: string) =>
  (await json<{ data: Coverage }>(await api.get(`/api/accounting/fiscal-years?coverage=1&date=${today}`))).data;

/**
 * A fiscal period OPEN for today: opens the suggested period, or creates this
 * year with the current month open. The phone, tablet and desktop runs race
 * here on a fresh database, so a failed create counts when another run won.
 */
async function ensureOpenPeriod(api: APIRequestContext, today: string) {
  const current = await coverage(api, today);
  if (current.ready) return;
  if (current.suggestion?.can_open) {
    const opened = await api.post(`/api/accounting/fiscal-periods/${current.suggestion.period.id}/open`, { data: {} });
    if (!opened.ok()) expect((await coverage(api, today)).ready, await opened.text()).toBe(true);
    return;
  }
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const periods = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(Date.UTC(year, i, 1));
    const end = new Date(Date.UTC(year, i + 1, 0));
    return {
      period_no: i + 1,
      name: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      status: i + 1 === month ? "OPEN" : "CLOSED",
    };
  });
  const created = await api.post("/api/accounting/fiscal-years", {
    data: { code: `fy${year}`, name: `FY ${year}`, start_date: `${year}-01-01`, end_date: `${year}-12-31`, periods },
  });
  if (!created.ok()) expect((await coverage(api, today)).ready, await created.text()).toBe(true);
}

async function ensureAccounts(api: APIRequestContext): Promise<{ cash: Account; equity: Account }> {
  const { data: types } = await json<{ data: { id: string; code: string }[] }>(await api.get("/api/accounting/account-types"));
  const find = async (code: string) =>
    (await json<{ data: Account[] }>(await api.get("/api/accounting/chart-of-accounts"))).data.find((a) => a.code === code);
  const ensure = async (spec: typeof CASH): Promise<Account> => {
    const found = await find(spec.code);
    if (found) return found;
    const typeId = types.find((t) => t.code === spec.type)?.id;
    expect(typeId, `account type ${spec.type}`).toBeTruthy();
    const created = await api.post("/api/accounting/chart-of-accounts", {
      data: { code: spec.code, name: spec.name, account_type_id: typeId, is_cash_bank: spec.is_cash_bank },
    });
    // Another project run may have created it a moment earlier.
    const account = created.ok() ? ((await created.json()) as { data: Account }).data : await find(spec.code);
    expect(account, `account ${spec.code}: ${created.ok() ? "" : await created.text()}`).toBeTruthy();
    return account!;
  };
  return { cash: await ensure(CASH), equity: await ensure(EQUITY) };
}

/**
 * Manual journal end to end: post a balanced entry through the form, then
 * find it in the journal list, the general ledger of its cash account and
 * the trial balance. Posted journals cannot be deleted, so each run leaves
 * one entry with a unique description.
 */
test.describe("accounting", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.use({ storageState: STAFF_STATE });

  test("posts a manual journal and shows it in the ledger and trial balance", async ({ page }) => {
    const today = jakartaToday();
    await ensureOpenPeriod(page.request, today);
    const { cash, equity } = await ensureAccounts(page.request);
    const description = `E2E setoran modal ${Date.now()}`;
    const amount = 100_000 + Math.floor(Math.random() * 900) * 1_000;

    await page.goto("/dashboard/accounting/journal-entries/insert");
    await expect(page.getByLabel("Tanggal")).toHaveValue(today);
    await page.getByLabel("Deskripsi").fill(description);

    const lines = page.getByRole("row").filter({ has: page.getByPlaceholder("Memo") });
    const fillLine = async (index: number, account: Account, side: "debit" | "credit") => {
      const line = lines.nth(index);
      await line.getByRole("button", { name: "Pilih akun" }).click();
      await page.getByPlaceholder("Cari COA...").fill(account.name);
      await page.getByRole("option", { name: new RegExp(account.name) }).click();
      await line.getByPlaceholder("0").nth(side === "debit" ? 0 : 1).fill(String(amount));
    };
    await fillLine(0, cash, "debit");
    await fillLine(1, equity, "credit");
    await expect(page.getByText("Selisih:")).toContainText("0,00");

    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/accounting\/journal-entries$/);
    const entry = page.getByRole("row").filter({ hasText: description });
    await expect(entry).toContainText("POSTED");
    const entryNo = (await entry.getByText(/^JE-\d{6}-\d+$/).textContent())!.trim();

    await page.goto("/dashboard/accounting/reports/general-ledger");
    await page.locator('main [data-slot="select-trigger"]').first().click();
    await page.getByPlaceholder("Cari kode / nama...").fill(cash.name);
    await page.getByRole("option", { name: new RegExp(cash.name) }).click();
    const ledgerLine = page.getByRole("row").filter({ hasText: entryNo });
    await expect(ledgerLine).toContainText(description);
    await expect(ledgerLine).toContainText(amount.toLocaleString("id-ID"));

    await page.goto("/dashboard/accounting/reports/trial-balance");
    await expect(page.getByRole("row").filter({ hasText: cash.name })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: equity.name })).toBeVisible();
  });
});
