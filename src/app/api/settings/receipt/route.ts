import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { loadPosReceiptSettingsRows, normalizeReceiptSettings } from "@/lib/pos/receipt-settings";
import { parseReceiptScopeInput, upsertReceiptScope } from "@/lib/settings/receipt-scope";

/**
 * GET /api/settings/receipt — semua baris konfigurasi struk aktif
 * (global + per-branch + per-warehouse), untuk UI Settings → Business. EPIC-040.
 */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const db = createPgClient();
  const rows = await loadPosReceiptSettingsRows(db);
  // Opsi scope untuk UI — di-query sendiri supaya halaman ini tidak
  // bergantung pada permission endpoint warehouse milik modul lain.
  const { data: stalls, error } = await db
    .from("warehouses")
    .select("id, name, branch_id")
    .order("name", { ascending: true });
  if (error) throw error;
  return NextResponse.json({
    success: true,
    data: rows.map((row) => normalizeReceiptSettings(row)),
    stalls: stalls ?? [],
  });
}, "GET /api/settings/receipt");

/**
 * PUT /api/settings/receipt — upsert satu scope.
 * Body: { warehouse_id?, branch_id?, header_lines, footer_lines, show_stall_name }.
 */
export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const input = parseReceiptScopeInput(await request.json().catch(() => ({})));
  const db = createPgClient();
  await upsertReceiptScope(db, input);
  const rows = await loadPosReceiptSettingsRows(db);
  return NextResponse.json({ success: true, data: rows.map((row) => normalizeReceiptSettings(row)) });
}, "PUT /api/settings/receipt");
