# POS Reservations Page UI Polish — Design

- **Date:** 2026-07-12
- **Status:** Approved (approach B)
- **Scope:** Full `/dashboard/pos/reservation` page + New Reservation / Customer search / WhatsApp dialogs
- **Related:** Waiting List seating (unchanged); Orders list UI patterns

---

## Goals

- English POS copy throughout the Reservations **UI** (WhatsApp guest message may stay guest-facing Indonesian or bilingual).
- Soft borders, semantic tokens (`primary`, `border-gray-200/70`, `muted-foreground`); no hardcoded Wonderland pink.
- All dialogs use `DialogPanel` (`sm` / `md`) with standard header / body / footer.
- New Reservation table picker: group by floor, optional Unassigned, scroll only inside the table section so the modal stays usable.
- List: card-wrapper rows (Orders/PR style), soft status badges, outline action buttons, toast + loading on mutations.

## Non-goals

- Waiting List / seat API changes
- Schema changes (`seated_at`, etc.)
- New reservation business rules

## Page

- Title: **Reservations**
- Primary CTA: **New Reservation**
- Filters: date input + status chips — All, Pending, Confirmed, Seated, Completed (active = primary soft fill)
- Empty / loading English copy
- Row: name + badge; phone · pax · time · table; notes/deposit when present
- Actions by status (English): Confirm, WhatsApp, Cancel; Seat, Reminder, No show; Complete

## Dialogs

1. **New Reservation** (`md`): Customer trigger, Date/Time, Guests, Select table (floor groups + Unassigned), Order type, Deposit chips (no `Rp` prefix), Notes → Cancel / Save (loading)
2. **Find customer** (`sm`): search + New guest + results
3. **Send WhatsApp** (`md`): preview + Cancel / Send via WhatsApp

## Success criteria

- Modal no longer forces full-page scroll for table grid alone
- Visual language matches other polished POS pages
- Mutations still work; toasts on success/error
