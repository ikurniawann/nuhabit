import { expect, test } from "../support/fixtures";

const PROMO_CODE = process.env.E2E_PROMO_CODE;
// Pressing Pay creates a pending order. Only do it when the API runs with
// XENDIT_MOCK=1, where the "invoice" is the store's own order status page.
const PAY_WITH_MOCK = process.env.E2E_SHOP_PAY_MOCK === "1";

test.describe("shop checkout", () => {
  test("add to cart, pick up at a branch, apply a promo, reach payment", async ({ page, context }) => {
    // Never leave for a real payment page, whatever the API answers.
    await context.route(/xendit\.co/, (route) => route.abort());

    await page.goto("/apparel");
    const add = page.getByRole("button", { name: /^Add .+ to cart$/ }).first();
    await expect(add, "a product that can be added").toBeVisible();
    const product = (await add.getAttribute("aria-label"))!.replace(/^Add (.+) to cart$/, "$1");
    // A product with sizes carries aria-expanded and opens its size picker first.
    const hasSizes = (await add.getAttribute("aria-expanded")) !== null;
    await add.click();
    if (hasSizes) {
      await page.getByRole("group", { name: `Sizes for ${product}` }).getByRole("button").and(page.locator(":enabled")).first().click();
    }

    // The "Added to cart" toast covers the drawer's Checkout button on a phone;
    // its own action opens the cart and closes the toast.
    await page.getByRole("button", { name: "View cart" }).click();
    await expect(page.getByRole("button", { name: /^Cart, [1-9]\d* items?$/ })).toBeVisible();
    const cart = page.getByRole("dialog", { name: "Cart" });
    await expect(cart.getByText(product).first()).toBeVisible();
    await cart.getByRole("button", { name: "Checkout" }).click();

    const checkout = page.getByRole("dialog", { name: "Checkout" });
    await checkout.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Shopper");
    await checkout.getByRole("textbox", { name: "WhatsApp number" }).fill("089990000002");
    await checkout.getByRole("radio", { name: /Pick up at a branch/ }).click();
    const branch = checkout.getByRole("radiogroup", { name: "Pickup branch" }).getByRole("radio").first();
    await branch.click();
    await expect(branch).toHaveAttribute("aria-checked", "true");

    if (PROMO_CODE) {
      await checkout.getByRole("textbox", { name: "Promo code" }).fill(PROMO_CODE);
      await checkout.getByRole("button", { name: "Apply" }).click();
      await expect(checkout.getByText(`${PROMO_CODE} applied`, { exact: false })).toBeVisible();
      await expect(checkout.getByText(`Discount (${PROMO_CODE})`)).toBeVisible();
    }

    await expect(checkout.getByRole("radio", { name: /Xendit/ })).toHaveAttribute("aria-checked", "true");
    const pay = checkout.getByRole("button", { name: /^Pay Now · Rp/ });
    await expect(pay).toBeEnabled();

    if (!PAY_WITH_MOCK) return;
    await pay.click();
    await expect(page).toHaveURL(/\/shop\/order\/[0-9a-f-]+/);
    await expect(page.getByText(/SHOP-\d{6}-\d{5}/).first()).toBeVisible();
  });
});
