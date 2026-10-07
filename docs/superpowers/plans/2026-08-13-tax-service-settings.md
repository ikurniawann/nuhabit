# Tax & Service Settings UI — Implementation Plan

> **For agentic workers:** implement UI reskin only; no API/schema changes.

**Goal:** Settings page focused on Tax + Service; advanced fees collapsed.

**Spec:** `docs/superpowers/specs/2026-08-13-tax-service-settings-design.md`

## File map

| File | Change |
|------|--------|
| `src/features/pos/billing-settings/components/billing-settings-page.tsx` | Reskin UI |
| `database/migrations/deltas/20260813120000_settings_tax_service_menu.sql` | Rename menu |
| `.airecap/task/task.md` | Track |

## Tasks

1. Rewrite billing settings page: Tax/Service cards + advanced collapse
2. Migration rename menu to Tax & Service
3. Manual smoke: open Settings → Tax & Service, toggle rates, save, verify cashier
