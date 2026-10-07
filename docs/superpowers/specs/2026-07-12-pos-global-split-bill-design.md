# POS Global Split Bill (Equal + By Item) — Design

- **Date:** 2026-07-12
- **Status:** Approved for planning
- **Author:** AI + product owner (brainstorming session)
- **Scope:** Align shared `SplitBillModal` with common restaurant split patterns: Split equally + Split by item only; English copy; DialogPanel shell
- **Related:** Restaurant mode, open bills, cashier (all consumers of `SplitBillModal`)

---

## 1. Context & Problem

POS already supports three split modes in `SplitBillModal`: equal, per-item, and
custom. Custom amount splits are uncommon on the floor compared to industry norms
(**split equally N ways** and **pay for what you ordered**). Copy is mixed
Indonesian (`Orang N`), and the dialog uses ad-hoc `DialogContent` instead of
`DialogPanel`.

**Decisions (brainstorming):**

| Question | Answer |
|---|---|
| Modes | **Industry core:** Equal + By item only (remove Custom) |
| Scope | **Shared modal** used by restaurant, cashier, and open-bills |
| Language | **English** — “Split equally”, “Split by item”, default `Guest N` |
| Implementation | **Refactor in place** `SplitBillModal` (keep API/`SplitConfig` compatible minus `custom`) |

---

## 2. Goals & Non-Goals

### Goals

- Offer only two modes that match global restaurant practice:
  - **Split equally** — divide check by N guests
  - **Split by item** — assign line quantities to guests
- English UI throughout the shared modal
- Default guest labels `Guest 1`…`Guest N` (editable)
- Use `DialogPanel` design system (soft borders, standard footer)
- Keep existing create-splits API + post-split payment flow

### Non-Goals

- Custom amount / free-form nominal mode
- Sequential “pay one share then leave rest open” without creating splits
- Seat map / guest seating diagram
- Tip per guest
- Backend API contract changes (beyond rejecting obsolete client payloads if any)
- Separate restaurant-only modal

---

## 3. Product model

| Mode key | UI label | Behavior |
|---|---|---|
| `equal` | Split equally | Guest count N ≥ 2; `total / N` with remainder on last guest; tax & discount split evenly (same rounding spirit as today) |
| `per-item` | Split by item | Assign each line item quantity across guests; tax & discount proportional to each guest’s item subtotal |

**Removed:** `custom` from UI and from `SplitConfig.mode` type.

**Confirm action:** builds `SplitConfig` → existing `onConfirm` / `createOrderSplits` → existing payment screen where wired.

---

## 4. UI structure

1. **Header** — title `Split Bill`; description shows bill total (and optional short hint)
2. **Mode toggle** — two options only (pills/tabs): Split equally | Split by item
3. **Guest count** — stepper (− / N / +), minimum 2
4. **Body**
   - Equal: list of guests with computed amount each
   - By item: item × guest quantity controls; warn if any quantity unassigned
5. **Guest labels** — optional text fields, placeholder `Guest N`
6. **Footer** — Cancel | **Create split** (loading/disabled while submitting or invalid)

**Validation**

- Equal: valid when N ≥ 2
- By item: every cart line fully assigned (no unassigned qty); split totals must reconcile with order total under existing rounding rules

**Visual standards:** soft borders (`border-gray-200/70`, `border-primary/20`); no hard black rings; English only.

---

## 5. Technical notes

### Types

```ts
export interface SplitConfig {
  mode: "equal" | "per-item";
  count: number;
  splits: { /* unchanged fields */ }[];
}
```

### Primary file

- `src/components/pos/SplitBillModal.tsx` — remove custom state/UI; English copy; DialogPanel

### Optional

- Extract pure calculators (`buildEqualSplits`, `buildPerItemSplits`) + unit tests

### Call sites (inherit UI; no flow redesign)

- `src/features/pos/restaurant/components/restaurant-page.tsx`
- `src/features/pos/cashier/components/cashier-page.tsx`
- `src/features/pos/open-bills/components/open-bills-page.tsx`

### Help

- Update `pos.split-bill` help string to English describing equal / by-item

---

## 6. Testing

### Unit (if helpers extracted)

- Equal: remainder on last guest; N=2,3
- Per-item: assignment totals; proportional tax/discount

### Manual

- Restaurant / cashier / open-bills: open Split Bill → equal → create → payment flow
- By item: cannot confirm with unassigned qty; success path works
- Custom mode no longer visible anywhere

---

## 7. Success criteria

- Operators recognize two global patterns: split equally and split by item.
- One shared modal behavior across POS surfaces.
- No custom-amount path in the product UI.
