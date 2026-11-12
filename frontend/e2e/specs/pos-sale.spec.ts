import { STAFF_MISSING, STAFF_STATE, staffCredentials } from "../support/auth";
import { DB_MISSING, closeDatabase, firstRow, hasDatabase } from "../support/db";
import { expect, test } from "../support/fixtures";

/**
 * A cash sale at the cashier: open a shift when shift management asks for
 * one, add a product, pay with exact cash, then find the order in the order
 * list. The sale stays: it is the record the order list must show.
 */
test.describe("POS sale", () => {
  test.skip(!staffCredentials(), STAFF_MISSING);
  test.skip(!hasDatabase(), DB_MISSING);
  test.use({ storageState: STAFF_STATE });
  test.afterAll(closeDatabase);

  test("sells a product for cash and lists the order", async ({ page }) => {
    // The cashier only rings up products whose master item sits in a stall; the e2e seed adds E2E-POS-001.
    const product = await firstRow<{ name: string; stall: string }>(
      `select pp.name, w.name as stall from pos.pos_products pp
        join item.products p on p.id = pp.source_product_id and p.deleted_at is null
        join configuration.warehouses w on w.id = p.warehouse_id and w.is_active
        where pp.is_active and pp.is_available and pp.base_price > 0 order by pp.sku = 'E2E-POS-001' desc, pp.created_at limit 1`
    );
    test.skip(!product, "no active POS product linked to a stall in this database");

    await page.goto("/dashboard/pos/cashier-new");
    await expect(page.getByRole("heading", { name: "POS Cashier" })).toBeVisible();

    // A sale belongs to one stall and a fresh session starts on "Semua Stall". The switch
    // button renders once the stall options load.
    const stallButton = page.getByRole("main").getByRole("button", { name: new RegExp(`^(Semua Stall|${product!.stall})$`) });
    await expect(stallButton).toBeVisible();
    if ((await stallButton.textContent())?.trim() === "Semua Stall") {
      await stallButton.click();
      await page.getByRole("dialog", { name: "Pindah Stall" }).getByRole("button", { name: new RegExp(`^${product!.stall}`) }).click();
      await expect(page.getByRole("main").getByRole("button", { name: product!.stall })).toBeVisible();
    }

    const shiftCash = page.getByLabel(/kas awal/i);
    await page.getByRole("textbox", { name: "Search products..." }).fill(product!.name);
    await page.getByRole("button", { name: new RegExp(`^${product!.name}`) }).first().click();
    if (await shiftCash.isVisible()) {
      await shiftCash.fill("500000");
      await page.getByRole("button", { name: /buka shift/i }).click();
      await page.getByRole("button", { name: new RegExp(`^${product!.name}`) }).first().click();
    }
    await expect(page.getByText("1 items")).toBeVisible();

    await page.getByRole("button", { name: /^Pay Rp/ }).click();
    const payment = page.getByRole("dialog");
    await payment.getByRole("button", { name: /^(Cash|Tunai)/i }).first().click();
    await payment.getByRole("button", { name: "Uang Pas" }).click();
    await payment.getByRole("button", { name: "Confirm payment" }).click();

    const receipt = page.getByRole("dialog", { name: "Print Struk" });
    await expect(receipt.getByRole("heading", { name: "Payment successful" })).toBeVisible({ timeout: 30_000 });
    await expect(receipt).toContainText("Tunai");
    // "Nomor Antrian · Order POS-20261112-0001" with a queue number, else "Order #<last 8 chars>".
    const shown = (await receipt.getByText(/Order #?[A-Z0-9-]+/).textContent())!.match(/Order #?([A-Z0-9-]+)/)![1];
    const order = await firstRow<{ order_number: string; payment_status: string }>(
      `select order_number, payment_status from pos.pos_orders
        where order_number = $1 or upper(right(order_number, 8)) = $1 or upper(right(id::text, 8)) = $1
        order by created_at desc limit 1`,
      [shown]
    );
    expect(order, `order ${shown} saved`).not.toBeNull();
    expect(order!.payment_status).toBe("paid");
    await receipt.getByRole("button", { name: "Transaksi baru" }).click();

    await page.goto("/dashboard/pos/orders");
    await expect(page.getByText(order!.order_number).first()).toBeVisible();
  });
});
