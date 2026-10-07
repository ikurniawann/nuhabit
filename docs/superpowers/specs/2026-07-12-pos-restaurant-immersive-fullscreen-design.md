# POS Restaurant Immersive Fullscreen — Design

- **Date:** 2026-07-12
- **Status:** Approved for planning
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Same-route immersive mode for `/dashboard/pos/restaurant` that hides the dashboard shell chrome and persists across cashier round-trips
- **Related:** `2026-07-12-pos-restaurant-mode-design.md` (v1 noted fullscreen as optional later)

---

## 1. Context & Problem

Restaurant table board lives under the standard POS dashboard shell (`AppSidebar` +
top bar). On tablets and floor stations, chrome steals horizontal space that the
board needs. Cashier already has a “fullscreen” variant, but it still keeps the
sidebar — operators want a true **immersive** restaurant surface.

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Fullscreen meaning | **Immersive** — hide sidebar + top bar; board fills the viewport |
| Entry / exit | **Same route toggle** (not a dedicated route) |
| Persistence | **Query `immersive=1`**, preserved through cashier handoff / return |
| Implementation | **Shell-aware query** — `AppSidebar` reads pathname + search params |

---

## 2. Goals & Non-Goals

### Goals

- Add Fullscreen / Exit Fullscreen toggle on `/dashboard/pos/restaurant`.
- When `?immersive=1`, hide dashboard sidebar, mobile header, and desktop top bar;
  give the restaurant layout near-full viewport height.
- Persist immersive mode via URL so refresh and cashier return keep the mode.
- Preserve selection, rails, dialogs, and existing restaurant behavior.

### Non-Goals

- Browser Fullscreen API (F11-style).
- New dedicated route (e.g. `restaurant-fullscreen`).
- Immersive mode for other POS pages (cashier, tables editor, etc.).
- New IAM permission or menu entry.
- Esc-to-exit immersive (avoid conflict with dialogs) in v1.

---

## 3. URL & navigation contract

**Base path:** `/dashboard/pos/restaurant` (`RESTAURANT_PATH`)

| Mode | URL |
|---|---|
| Normal | `/dashboard/pos/restaurant` |
| Immersive | `/dashboard/pos/restaurant?immersive=1` |

**Helpers** (extend `src/features/pos/restaurant/nav.ts`):

- `RESTAURANT_IMMERSIVE_PARAM = "immersive"`
- `isRestaurantImmersive(searchParams)` — true when param is `"1"`
- `restaurantPath({ immersive?: boolean })` — builds path ± query
- `buildCashierHandoffUrl` — when `immersive: true` (or caller passes it), also set
  `immersive=1` on the cashier URL alongside `from=restaurant`

**Cashier return:** when `from=restaurant` and `immersive=1` were present on the
cashier URL, return to `restaurantPath({ immersive: true })` instead of bare
`RESTAURANT_PATH`.

Toggle uses `router.replace` so back-stack is not polluted and in-page selection
state is preserved.

---

## 4. Shell behavior (`AppSidebar`)

When `pathname === RESTAURANT_PATH` **and** `isRestaurantImmersive(searchParams)`:

- Do **not** render: aside (desktop sidebar), mobile menu overlay / mobile header,
  desktop top bar (breadcrumbs / theme / account).
- Render `children` in a full-bleed main region (`p-0` or minimal padding).
- Keep account popup / toasters available if already mounted outside the hidden chrome;
  no need to expose account UI inside immersive chrome in v1.

When immersive is off, behavior is unchanged.

Gate is **restaurant-only** — other routes ignore `immersive`.

---

## 5. Restaurant page UI

### Toggle

- Outline button with soft borders (match cashier / UI standards).
- Icons: `ArrowsPointingOutIcon` (enter) / `ArrowsPointingInIcon` (exit).
- Labels: **Fullscreen** / **Exit Fullscreen**.
- Placement: thin top strip above the 3-column grid (right-aligned actions).

### Immersive chrome

- Thin full-width strip: short title (“Restaurant”) + Exit Fullscreen.
- 3-column grid unchanged (action rail | table board | bills rail).
- Shell height targets ~`100dvh` minus the strip so the board uses available space.

### Unchanged

- Selection, move/split modals, preview bill / view orders dialogs, cashier handoff
  actions (aside from immersive query propagation).

---

## 6. Data flow

```text
[Restaurant normal]
  → toggle Fullscreen
  → replace URL ?immersive=1
  → AppSidebar hides chrome

[Restaurant immersive]
  → open table / takeaway / bill → cashier-new?from=restaurant&…&immersive=1
  → pay or save open bill
  → restaurant?immersive=1
```

No new API or server state. Immersive is entirely client URL + shell rendering.

---

## 7. Testing

### Unit

- `isRestaurantImmersive` / `restaurantPath` query building.
- `buildCashierHandoffUrl` includes `immersive=1` when requested.
- Cashier return helper (or existing return sites) preserves immersive when set.

### Manual

- Toggle hides sidebar + top bar; Exit restores them.
- Refresh on `?immersive=1` stays immersive.
- Handoff to cashier and return keeps immersive.
- Dialogs / modals still open and close correctly over immersive layout.

---

## 8. File touch list (expected)

| Area | Files |
|---|---|
| Nav helpers + tests | `src/features/pos/restaurant/nav.ts`, `nav.test.ts` |
| Page UI | `src/features/pos/restaurant/components/restaurant-page.tsx` (+ small chrome strip if split) |
| Shell | `src/components/shared/app-sidebar.tsx` |
| Cashier return | `src/features/pos/cashier/components/cashier-page.tsx` (return pushes) |
| Handoff call sites | table board / bills rail / action rail — pass immersive into `buildCashierHandoffUrl` |

---

## 9. Success criteria

- Operators can run restaurant board without dashboard chrome on the same URL.
- Immersive survives refresh and cashier round-trip via `immersive=1`.
- Normal (non-immersive) restaurant UX remains the default for sidebar navigation.
