# Storefront: faster checkout, easier browsing, trust and polish

Approved on 2026-10-10. Base branch `feat/storefront-ux` (on top of
`feat/member-password-login`, PR #4).

## Faster checkout

- Delivery choice first: ship, or pick up at a public branch. Pickup skips the
  address and rate steps, sets `shipping_cost` 0, `delivery_method = 'pickup'`
  and `pickup_branch_id` on `shop.orders`. The status page shows the branch
  address and a "ready for pickup" step that staff set from the orders page.
- One-screen checkout: contact, delivery, promo code, summary and the pay
  button on one sheet. Address and phone are remembered in the browser.
- Promo codes: `promo.promo_codes` and `promo_redemptions` through the
  stored-value promo package, validated and redeemed inside the order
  transaction, shown as a discount line in the cart, invoice and status page.
- Member checkout: with a `member_session` cookie the form is prefilled from
  the member and the last order, the order links to the member, and ARK Coin
  pays the whole total when the balance covers it (stored-value module, same
  transaction, no Xendit). Orders appear in the member's transactions.
- WhatsApp confirmation when the order is placed, with the status link, and a
  "Chat on WhatsApp" button on the status page.

## Easier browsing

- Quick add from the grid: size picker on variant cards, one tap on single-SKU
  cards, cart toast.
- Size and price filters next to the sort, in the URL.
- "Low stock" (threshold in storefront settings, default 3) and "Back in stock"
  (restocked within 7 days) badges.
- Recently viewed row (browser storage) and a wishlist (browser storage for
  guests, saved on the member account when signed in).

## Trust and polish

- Product reviews from members with a paid order containing the product,
  written from their order page, shown on the product sheet with average and
  count, moderated from the dashboard. New table `shop.product_reviews`.
- Free-shipping progress bar in the cart (threshold in storefront settings).
- Delivery estimates from the courier quote on checkout and status; pre-order
  items show the expected ship date on card, sheet and cart.
- "You may also like": four products from the same collection on the sheet.

## Rules

Every route runs in Go (shop module; ports to stored-value for promo and ARK
Coin, to site for branches). Storefront settings (free-shipping threshold,
low-stock threshold, pickup on or off, WhatsApp number) live in a small
dashboard form. English copy. Go integration tests for pickup, promo, ARK
Coin and reviews; Vitest for cart, filters, wishlist and checkout state; a
browser pass at 375 and 1280 with the seeded demo apparel.

Waves: (1) checkout and settings, (2) browsing, reviews and polish.
