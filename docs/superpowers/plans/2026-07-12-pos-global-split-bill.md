# Global Split Bill (Equal + By Item) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development).

**Goal:** Refactor shared `SplitBillModal` to industry core modes only (Split equally + Split by item), English copy, DialogPanel shell.

**Architecture:** Extract pure split calculators + tests; rewrite modal UI; update help string. Call sites unchanged.

**Tech Stack:** React, DialogPanel, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-global-split-bill-design.md`
- Modes: `equal` | `per-item` only; remove `custom`
- English: Guest N, Split equally, Split by item, Create split
- Soft borders / DialogPanel

## File map

| File | Responsibility |
|------|----------------|
| `src/components/pos/split-bill-calc.ts` | Pure equal / per-item builders |
| `src/components/pos/split-bill-calc.test.ts` | Unit tests |
| `src/components/pos/SplitBillModal.tsx` | DialogPanel UI, 2 modes |
| `src/lib/help/help-content.ts` | English help blurb |

---

### Task 1: Calc helpers + tests

- [ ] `guestLabel(i)`, `buildEqualSplits`, `buildPerItemSplits`, `countUnassignedQty`
- [ ] Tests for remainder, N=2/3, unassigned, proportional tax
- [ ] Commit: `feat(pos): extract split bill calculators`

### Task 2: Modal + help

- [ ] Rewrite `SplitBillModal` (no custom; DialogPanel; English)
- [ ] Update `pos.split-bill` help
- [ ] Run: `npx vitest run src/components/pos/split-bill-calc.test.ts`
- [ ] Commit: `feat(pos): align SplitBillModal to equal and by-item`

---

## Execution

User requested immediate implementation — execute Tasks 1–2 in this session.
