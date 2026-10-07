# POS Table Floor Plan (2D Denah) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a List | Denah tab on `/dashboard/pos/tables` with a 2D drag canvas that auto-saves `pos_x`/`pos_y` (percent) to the database.

**Architecture:** Extend `pos.pos_tables` with nullable `pos_x`/`pos_y`. Dedicated `PATCH /api/pos/tables/[id]/position` for auto-save. Frontend uses pointer events + CSS absolute nodes (no new drag libraries). Unplaced tables get client-side grid positions until first drag.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, PostgreSQL (`pos` schema), Vitest, existing `@/components/ui/tabs` + DialogPanel patterns, soft borders per UI standards.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-pos-table-floor-plan-design.md`
- No new runtime dependencies (no dnd-kit / Konva / Fabric).
- Coordinates are **percent 0–100** of canvas (top-left of node).
- Auto-save on pointer-up only (no “Simpan denah” button).
- Soft borders only (`border-gray-200/70`); match Purchasing / Meja list styling.
- Every mutation shows loading + toast success/error (no duplicate toasts).
- Indonesian UI copy.
- Out of scope: resize, rotate, snap grid, kasir floor plan, multi-zone maps.
- `DialogPanelForm` must stay **inside** `DialogPanel` (portal form association).

## File map

| File | Responsibility |
|---|---|
| `database/migrations/deltas/20260712120000_pos_tables_floor_position.sql` | Add `pos_x`, `pos_y` |
| `src/features/pos/tables/types.ts` | Add `pos_x?`, `pos_y?` on row type |
| `src/features/pos/tables/floor-layout.ts` | Pure helpers: clamp %, grid placement |
| `src/features/pos/tables/floor-layout.test.ts` | Unit tests for helpers |
| `src/app/api/pos/tables/route.ts` | GET/POST include `pos_x`, `pos_y` |
| `src/app/api/pos/tables/[id]/route.ts` | PATCH select includes positions (no form change required) |
| `src/app/api/pos/tables/[id]/position/route.ts` | Dedicated position PATCH |
| `src/features/pos/tables/api.ts` | `patchPosTablePosition` |
| `src/features/pos/tables/mutations.ts` | `usePatchPosTablePosition` + optimistic cache |
| `src/features/pos/tables/components/tables-floor-plan.tsx` | Canvas + drag + click-to-edit |
| `src/features/pos/tables/components/tables-page.tsx` | Tabs List \| Denah; keep CRUD dialogs |

---

### Task 1: Migration + types + layout helpers (TDD)

**Files:**
- Create: `database/migrations/deltas/20260712120000_pos_tables_floor_position.sql`
- Modify: `src/features/pos/tables/types.ts`
- Create: `src/features/pos/tables/floor-layout.ts`
- Create: `src/features/pos/tables/floor-layout.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `PosTableRow.pos_x: number | null | undefined`
  - `PosTableRow.pos_y: number | null | undefined`
  - `clampPercent(n: number): number` → finite number clamped to `[0, 100]`, rounded to 2 decimals
  - `isPlaced(pos_x, pos_y): boolean` → both non-null finite
  - `assignGridPositions(ids: string[], cols?: number): Record<string, { pos_x: number; pos_y: number }>` → stable grid starting at (4,4) with step ~12 x / 14 y

- [ ] **Step 1: Write failing tests**

Create `src/features/pos/tables/floor-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assignGridPositions,
  clampPercent,
  isPlaced,
} from "./floor-layout";

describe("clampPercent", () => {
  it("clamps below 0 and above 100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
  });

  it("rounds to 2 decimals", () => {
    expect(clampPercent(12.3456)).toBe(12.35);
  });

  it("returns 0 for non-finite", () => {
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("isPlaced", () => {
  it("requires both coordinates", () => {
    expect(isPlaced(10, 20)).toBe(true);
    expect(isPlaced(null, 20)).toBe(false);
    expect(isPlaced(10, undefined)).toBe(false);
  });
});

describe("assignGridPositions", () => {
  it("places tables in a grid without overlap of keys", () => {
    const map = assignGridPositions(["a", "b", "c"], 2);
    expect(Object.keys(map)).toEqual(["a", "b", "c"]);
    expect(map.a.pos_x).toBeLessThan(map.b.pos_x);
    expect(map.c.pos_y).toBeGreaterThan(map.a.pos_y);
    expect(map.a.pos_x).toBeGreaterThanOrEqual(0);
    expect(map.a.pos_x).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/features/pos/tables/floor-layout.test.ts
```

Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement helpers + migration + types**

`database/migrations/deltas/20260712120000_pos_tables_floor_position.sql`:

```sql
-- Floor-plan coordinates for POS tables (percent of canvas, 0–100).
ALTER TABLE pos.pos_tables
  ADD COLUMN IF NOT EXISTS pos_x numeric(8,2),
  ADD COLUMN IF NOT EXISTS pos_y numeric(8,2);
```

`src/features/pos/tables/types.ts` — add to `PosTableRow`:

```ts
  pos_x?: number | null;
  pos_y?: number | null;
```

`src/features/pos/tables/floor-layout.ts`:

```ts
export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

export function isPlaced(
  pos_x: number | null | undefined,
  pos_y: number | null | undefined
): boolean {
  return (
    pos_x != null &&
    pos_y != null &&
    Number.isFinite(pos_x) &&
    Number.isFinite(pos_y)
  );
}

/** Client-only initial layout for tables that have never been dragged. */
export function assignGridPositions(
  ids: string[],
  cols = 6
): Record<string, { pos_x: number; pos_y: number }> {
  const out: Record<string, { pos_x: number; pos_y: number }> = {};
  const startX = 4;
  const startY = 4;
  const stepX = 14;
  const stepY = 16;
  ids.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out[id] = {
      pos_x: clampPercent(startX + col * stepX),
      pos_y: clampPercent(startY + row * stepY),
    };
  });
  return out;
}
```

- [ ] **Step 4: Apply migration + run tests**

```bash
npm run db:migrate:apply
npx vitest run src/features/pos/tables/floor-layout.test.ts
```

Expected: migrate OK; PASS.

Verify columns:

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d arkiv -c "\d pos.pos_tables" | rg pos_
```

Expected: `pos_x` and `pos_y` listed.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/deltas/20260712120000_pos_tables_floor_position.sql \
  src/features/pos/tables/types.ts \
  src/features/pos/tables/floor-layout.ts \
  src/features/pos/tables/floor-layout.test.ts
git commit -m "$(cat <<'EOF'
feat(pos): add table floor-plan position columns and layout helpers

EOF
)"
```

---

### Task 2: API — return positions + PATCH position endpoint

**Files:**
- Modify: `src/app/api/pos/tables/route.ts`
- Modify: `src/app/api/pos/tables/[id]/route.ts`
- Create: `src/app/api/pos/tables/[id]/position/route.ts`
- Create: `src/features/pos/tables/position-payload.ts` (shared parse/clamp for API + test)
- Create: `src/features/pos/tables/position-payload.test.ts`

**Interfaces:**
- Consumes: `clampPercent` from `floor-layout.ts`
- Produces:
  - `parsePositionPayload(body: unknown): { data: { pos_x: number; pos_y: number } } | { error: string }`
  - `PATCH /api/pos/tables/[id]/position` → `{ success, data: { id, pos_x, pos_y }, message }`
  - GET/POST normalize includes `pos_x`, `pos_y`

- [ ] **Step 1: Write failing payload tests**

```ts
import { describe, expect, it } from "vitest";
import { parsePositionPayload } from "./position-payload";

describe("parsePositionPayload", () => {
  it("accepts valid numbers and clamps", () => {
    expect(parsePositionPayload({ pos_x: -1, pos_y: 200 })).toEqual({
      data: { pos_x: 0, pos_y: 100 },
    });
  });

  it("rejects missing fields", () => {
    const result = parsePositionPayload({ pos_x: 10 });
    expect("error" in result).toBe(true);
  });

  it("rejects non-numeric", () => {
    const result = parsePositionPayload({ pos_x: "a", pos_y: 1 });
    expect("error" in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/features/pos/tables/position-payload.test.ts
```

- [ ] **Step 3: Implement parser + wire APIs**

`src/features/pos/tables/position-payload.ts`:

```ts
import { clampPercent } from "./floor-layout";

export function parsePositionPayload(
  body: unknown
): { data: { pos_x: number; pos_y: number } } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Payload posisi tidak valid" };
  }
  const record = body as Record<string, unknown>;
  const x = Number(record.pos_x);
  const y = Number(record.pos_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { error: "pos_x dan pos_y wajib angka" };
  }
  return { data: { pos_x: clampPercent(x), pos_y: clampPercent(y) } };
}
```

Update `normalizeTable` in `src/app/api/pos/tables/route.ts` and `[id]/route.ts`:

- Extend `TableRow` with `pos_x?: number | string | null; pos_y?: number | string | null`
- In select strings add `pos_x, pos_y`
- In normalize return:

```ts
pos_x: table.pos_x == null ? null : Number(table.pos_x),
pos_y: table.pos_y == null ? null : Number(table.pos_y),
```

Create `src/app/api/pos/tables/[id]/position/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { parsePositionPayload } from "@/features/pos/tables/position-payload";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "ID meja wajib" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = parsePositionPayload(body);
    if ("error" in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const { data, error } = await db
      .from("pos_tables")
      .update({
        pos_x: parsed.data.pos_x,
        pos_y: parsed.data.pos_y,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, pos_x, pos_y")
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { success: false, error: "Meja tidak ditemukan" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Posisi meja disimpan",
      data: {
        id: (data as { id: string }).id,
        pos_x: Number((data as { pos_x: number }).pos_x),
        pos_y: Number((data as { pos_y: number }).pos_y),
      },
    });
  } catch (error) {
    console.error("POS table position error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Gagal menyimpan posisi",
      },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run payload tests**

```bash
npx vitest run src/features/pos/tables/position-payload.test.ts src/features/pos/tables/floor-layout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pos/tables/route.ts \
  src/app/api/pos/tables/\[id\]/route.ts \
  src/app/api/pos/tables/\[id\]/position/route.ts \
  src/features/pos/tables/position-payload.ts \
  src/features/pos/tables/position-payload.test.ts
git commit -m "$(cat <<'EOF'
feat(pos): expose table positions and dedicated position PATCH API

EOF
)"
```

---

### Task 3: Client API + optimistic mutation

**Files:**
- Modify: `src/features/pos/tables/api.ts`
- Modify: `src/features/pos/tables/mutations.ts`

**Interfaces:**
- Consumes: `PATCH /api/pos/tables/[id]/position`
- Produces:
  - `patchPosTablePosition(id: string, pos: { pos_x: number; pos_y: number }): Promise<{ data: { id: string; pos_x: number; pos_y: number }; message?: string }>`
  - `usePatchPosTablePosition()` mutation with optimistic update on `posTablesQueryKeys.all`

- [ ] **Step 1: Add API client function**

In `api.ts`:

```ts
export async function patchPosTablePosition(
  id: string,
  pos: { pos_x: number; pos_y: number }
) {
  const res = await fetch(`/api/pos/tables/${id}/position`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pos),
  });
  return parseJson<{
    data: { id: string; pos_x: number; pos_y: number };
    message?: string;
  }>(res);
}
```

- [ ] **Step 2: Add mutation with optimistic cache**

In `mutations.ts`:

```ts
import { patchPosTablePosition } from "./api";
import type { PosTableRow } from "./types";

export function usePatchPosTablePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      pos_x,
      pos_y,
    }: {
      id: string;
      pos_x: number;
      pos_y: number;
    }) => patchPosTablePosition(id, { pos_x, pos_y }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: posTablesQueryKeys.all });
      const previous = qc.getQueriesData<PosTableRow[]>({
        queryKey: posTablesQueryKeys.all,
      });
      qc.setQueriesData<PosTableRow[]>(
        { queryKey: posTablesQueryKeys.all },
        (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((row) =>
            row.id === vars.id
              ? { ...row, pos_x: vars.pos_x, pos_y: vars.pos_y }
              : row
          );
        }
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: posTablesQueryKeys.all });
    },
  });
}
```

Keep existing create/update/delete mutations unchanged.

- [ ] **Step 3: Typecheck touched files**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | rg "pos/tables" | head -20
```

Expected: no errors under `pos/tables` (or empty output).

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/tables/api.ts src/features/pos/tables/mutations.ts
git commit -m "$(cat <<'EOF'
feat(pos): add client mutation for table floor position auto-save

EOF
)"
```

---

### Task 4: Floor plan canvas component

**Files:**
- Create: `src/features/pos/tables/components/tables-floor-plan.tsx`

**Interfaces:**
- Consumes: `PosTableRow[]`, `assignGridPositions`, `clampPercent`, `isPlaced`, `usePatchPosTablePosition`
- Produces: `<TablesFloorPlan tables={...} onEdit={(row) => void} />`

- [ ] **Step 1: Implement `TablesFloorPlan`**

Create `tables-floor-plan.tsx` with:

- Props: `{ tables: PosTableRow[]; onEdit: (table: PosTableRow) => void }`
- Canvas: `relative min-h-[480px] w-full overflow-hidden rounded-xl border border-gray-200/70 bg-gray-50`
- Node size constants: `NODE_W = 88`, `NODE_H = 72` (px) — used only to clamp so nodes stay inside canvas (`maxX% = 100 - (NODE_W/width*100)`).
- Resolve display positions:
  1. Build `unplacedIds` where `!isPlaced(t.pos_x, t.pos_y)`
  2. `grid = assignGridPositions(unplacedIds)`
  3. For each table: placed → DB coords; else → grid[id]
- Local override map `dragging: Record<id, {x,y}>` while pointer down.
- Pointer handlers on each node:
  - `pointerdown`: `setPointerCapture`, store start client + start %, `moved=false`
  - `pointermove`: if capture active, compute delta → new %, clamp with canvas rect + node size; set `moved` if delta > 4px; update dragging map
  - `pointerup`: release capture; if `!moved` → `onEdit(table)`; else `mutateAsync` with toast (`Posisi meja disimpan` / error). Track `savingId` for opacity/spinner on that node.
- Status colors: reuse same tones as list (`available` emerald, `occupied` amber, `reserved` blue, `maintenance` slate). Inactive tables: `opacity-50`.
- Node content: `table_number` bold + `capacity` seats small text.
- `touch-action: none` + `select-none` on nodes; `cursor-grab` / `cursor-grabbing`.
- Soft shadow; no black borders.

Skeleton outline:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  assignGridPositions,
  clampPercent,
  isPlaced,
} from "../floor-layout";
import { usePatchPosTablePosition } from "../mutations";
import type { PosTableRow } from "../types";

const NODE_W = 88;
const NODE_H = 72;
const CLICK_THRESHOLD_PX = 4;

type Props = {
  tables: PosTableRow[];
  onEdit: (table: PosTableRow) => void;
};

export function TablesFloorPlan({ tables, onEdit }: Props) {
  // ... canvasRef, dragState, savingId, mutation
  // ... resolvePositions memo
  // ... render canvas + mapped nodes
}
```

Implement full drag math in the file (no placeholders). On success toast use mutation response message; on error show `err.message`.

- [ ] **Step 2: Manual smoke (dev server)**

If `npm run dev` is available, open `/dashboard/pos/tables` temporarily by wiring in Task 5 — or import-check:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | rg "tables-floor-plan" | head -20
```

Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/tables/components/tables-floor-plan.tsx
git commit -m "$(cat <<'EOF'
feat(pos): add 2D table floor-plan canvas with drag auto-save

EOF
)"
```

---

### Task 5: Wire tabs List | Denah into TablesPage

**Files:**
- Modify: `src/features/pos/tables/components/tables-page.tsx`

**Interfaces:**
- Consumes: `TablesFloorPlan`, existing CRUD dialogs/handlers
- Produces: tabbed page defaulting to `list`

- [ ] **Step 1: Add tabs shell**

Import:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TablesFloorPlan } from "./tables-floor-plan";
```

After the page header (keep **Tambah Meja** in header for both tabs), wrap list section:

```tsx
<Tabs defaultValue="list" className="w-full">
  <TabsList className="mb-4">
    <TabsTrigger value="list">List</TabsTrigger>
    <TabsTrigger value="denah">Denah</TabsTrigger>
  </TabsList>

  <TabsContent value="list" className="mt-0">
    {/* existing PurchasingListSection + table unchanged */}
  </TabsContent>

  <TabsContent value="denah" className="mt-0">
    {isLoading ? (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-sm text-gray-500">Memuat denah…</p>
      </div>
    ) : error ? (
      <div className="py-14 text-center text-sm text-red-600">
        {error instanceof Error ? error.message : "Gagal memuat meja"}
      </div>
    ) : tables.length === 0 ? (
      <div className="rounded-xl border border-gray-200/70 bg-white py-14 text-center">
        <p className="text-gray-500">Belum ada data meja</p>
        <Button type="button" variant="outline" onClick={openAdd} className="mt-4">
          Tambah Meja Pertama
        </Button>
      </div>
    ) : (
      <div className="rounded-xl border border-gray-200/70 bg-white p-4">
        <TablesFloorPlan tables={tables} onEdit={openEdit} />
      </div>
    )}
  </TabsContent>
</Tabs>
```

Keep create/edit/delete dialogs outside tabs (shared). Do **not** wrap `DialogPanelForm` outside `DialogPanel`.

- [ ] **Step 2: Acceptance check**

Manual checklist (from spec §8):

1. Tab Denah shows unplaced tables in a grid.
2. Drag + release persists after refresh.
3. Failed save shows toast + rollback (DevTools offline optional).
4. Click without drag opens edit dialog.
5. List tab CRUD still works.
6. Window resize keeps relative positions.

- [ ] **Step 3: Run unit tests**

```bash
npx vitest run src/features/pos/tables/
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/tables/components/tables-page.tsx
git commit -m "$(cat <<'EOF'
feat(pos): add List/Denah tabs for table floor plan on Meja page

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `pos_x` / `pos_y` columns | 1 |
| Percent coords + clamp | 1–2 |
| GET returns positions | 2 |
| `PATCH .../position` auto-save API | 2 |
| Client mutation + optimistic | 3 |
| Canvas drag pointer events | 4 |
| Unplaced grid layout | 1 + 4 |
| Click vs drag threshold | 4 |
| Status colors + inactive opacity | 4 |
| Tabs List \| Denah + Tambah Meja | 5 |
| Reuse edit dialog from floor | 5 |
| No new deps / no resize-rotate | all |

## Self-review notes

- No TBD/placeholder steps.
- Types `pos_x`/`pos_y` consistent across migration, API, client, UI.
- Form portal bug from earlier CRUD work called out in Global Constraints.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-pos-table-floor-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
