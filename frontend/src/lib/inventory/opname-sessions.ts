import { z } from "zod";
import type { createServerPgClient } from "@/lib/pg/create-client";
import {
  assertOpnameEditable,
  countedLineValues,
  summarizeOpnameCounts,
} from "@/lib/inventory/opname-rules";

type PgClient = Awaited<ReturnType<typeof createServerPgClient>>;

export const opnameListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  warehouse_id: z.string().uuid().optional(),
  search: z.string().optional(),
  reason: z.enum(["stock_opname", "manual_adjustment"]).optional(),
});

export type OpnameListQuery = z.infer<typeof opnameListQuerySchema>;

export function opnameCreateSchema(warehouseMessage: string) {
  return z.object({
    warehouse_id: z.string().uuid(warehouseMessage),
    opname_date: z.string().optional(),
    notes: z.string().optional(),
    reason: z.enum(["stock_opname", "manual_adjustment"]).default("stock_opname"),
  });
}

export type OpnameCreateInput = z.infer<ReturnType<typeof opnameCreateSchema>>;

export const opnamePatchSchema = z.object({
  notes: z.string().optional(),
  status: z.enum(["cancelled"]).optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty_counted: z.number().min(0).nullable(),
        notes: z.string().optional(),
      })
    )
    .optional(),
});

export type OpnamePatchInput = z.infer<typeof opnamePatchSchema>;

type OpnameDetail = {
  status: string;
  notes: string | null;
  lines: Array<{
    id: string;
    qty_system: number;
    notes?: string | null;
    qty_counted?: number | null;
    qty_variance?: number | null;
  }>;
};

/**
 * PATCH opname (bahan baku & produk memakai alur sama, beda tabel): batalkan,
 * atau simpan qty hitung per baris lalu rekap header. Mengembalikan "cancelled"
 * atau "saved" untuk pesan respons.
 */
export async function applyOpnameChanges<T extends OpnameDetail>(opts: {
  db: PgClient;
  tables: { header: string; lines: string };
  id: string;
  userId: string;
  input: OpnamePatchInput;
  load: (id: string) => Promise<T | null>;
  detail: T;
}): Promise<"cancelled" | "saved"> {
  const { db, tables, id, userId, input, load, detail } = opts;
  assertOpnameEditable(detail);
  const now = () => new Date().toISOString();

  if (input.status === "cancelled") {
    await db
      .from(tables.header)
      .update({ status: "cancelled", updated_by: userId, updated_at: now() })
      .eq("id", id);
    return "cancelled";
  }

  for (const line of input.lines ?? []) {
    const existing = detail.lines.find((l) => l.id === line.id);
    if (!existing) continue;
    await db
      .from(tables.lines)
      .update({
        ...countedLineValues(line.qty_counted, existing.qty_system),
        notes: line.notes ?? existing.notes,
        updated_at: now(),
      })
      .eq("id", line.id);
  }

  const refreshed = (await load(id)) ?? detail;
  await db
    .from(tables.header)
    .update({
      ...summarizeOpnameCounts(refreshed.status, refreshed.lines),
      notes: input.notes ?? refreshed.notes,
      updated_by: userId,
      updated_at: now(),
    })
    .eq("id", id);
  return "saved";
}
