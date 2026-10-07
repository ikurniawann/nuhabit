# Restaurant Waiting List ↔ Reservations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development).

**Goal:** Waiting List on restaurant shows today’s pending/confirmed reservations and seats them onto available tables with an empty open bill.

**Architecture:** `WaitingListDialog` + board `seat` mode; `POST /reservations/[id]/seat` creates empty bill + marks seated; reuse available-table pick eligibility.

**Tech Stack:** Next.js route handlers, React Query, DialogPanel, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-restaurant-waiting-list-reservations-design.md`
- English; soft borders; mutual exclusive board modes
- Empty open bill allowed via seat route (cashier open-bill still requires items)

## File map

| File | Responsibility |
|------|----------------|
| `src/app/api/pos/reservations/[id]/seat/route.ts` | Seat + empty bill |
| `src/lib/pos-api.ts` | `seatReservation` |
| `src/features/pos/restaurant/components/waiting-list-dialog.tsx` | Dialog UI |
| `restaurant-action-rail.tsx` / `restaurant-page.tsx` / `restaurant-table-board.tsx` | Wire seat mode |
| `move-destination.ts` | `canPickSeatDestination` alias |

---

### Task 1: API + client
### Task 2: Dialog + board wiring
### Task 3: Tests + commit

## Execution

User requested immediate implementation — execute inline.
