import "server-only";
/**
 * EPIC-050 Fase 4 — sisi server report builder: visibilitas, eksekusi query,
 * pemuatan report tersimpan, dan perakitan sheet XLSX.
 */
import type { ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  buildReportQuery,
  datasetDef,
  formatCellValue,
  reportDefinitionSchema,
  type BuiltReport,
  type ReportDataset,
  type ReportDefinition,
} from "./report-builder";

/** Hanya admin/super admin yang boleh mengubah report bersama, dashboard default & jadwal. */
export function canManageShared(user: ApiUser): boolean {
  return user.role === "super_admin" || user.role === "admin";
}

/** Baris yang boleh dilihat: global + company user, dan bukan report privat orang lain. */
export function reportVisibilityWhere(alias: string, user: ApiUser, scope: UserScope | null, params: unknown[]): string {
  const parts: string[] = [];
  if (scope?.companyId) {
    params.push(scope.companyId);
    parts.push(`(${alias}.company_id IS NULL OR ${alias}.company_id = $${params.length})`);
  }
  params.push(user.id);
  parts.push(`(${alias}.is_shared OR ${alias}.created_by = $${params.length})`);
  return parts.join(" AND ");
}

/** Role sales hanya melihat record miliknya di dalam hasil report. */
export function ownerRestriction(user: ApiUser): string | null {
  return user.role === "sales" ? user.id : null;
}

export interface ReportRow {
  [key: string]: unknown;
}

export interface ReportResult {
  columns: BuiltReport["columns"];
  rows: ReportRow[];
  grouped: boolean;
  dataset: ReportDataset;
  row_count: number;
  truncated: boolean;
}

/** Jalankan definisi report dan kembalikan kolom + baris. */
export async function runReportDefinition(
  definition: ReportDefinition,
  user: ApiUser,
  scope: UserScope | null
): Promise<ReportResult> {
  const built = buildReportQuery(definition, {
    companyId: scope?.companyId ?? null,
    restrictOwnerUserId: ownerRestriction(user),
  });
  const rows = await query<ReportRow>(built.sql, built.params);
  return {
    columns: built.columns,
    rows,
    grouped: built.grouped,
    dataset: definition.dataset,
    row_count: rows.length,
    truncated: rows.length >= definition.limit,
  };
}

export interface SavedReportRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  dataset: ReportDataset;
  definition: unknown;
  is_shared: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator_name?: string | null;
}

/** Ambil report tersimpan yang boleh diakses user; null bila tidak ada/tak berhak. */
export async function loadAccessibleReport(
  id: string,
  user: ApiUser,
  scope: UserScope | null
): Promise<SavedReportRow | null> {
  const params: unknown[] = [id];
  const visibility = reportVisibilityWhere("r", user, scope, params);
  return queryOne<SavedReportRow>(
    `SELECT r.id, r.company_id, r.name, r.description, r.dataset, r.definition, r.is_shared,
            r.created_by, r.created_at, r.updated_at, u.full_name AS creator_name
     FROM crm.crm_reports r
     LEFT JOIN configuration.users u ON u.id = r.created_by
     WHERE r.id = $1 AND r.deleted_at IS NULL AND ${visibility}`,
    params
  );
}

/** Definisi tersimpan → objek tervalidasi (baris lama yang rusak tidak menjatuhkan API). */
export function parseStoredDefinition(dataset: ReportDataset, raw: unknown): ReportDefinition {
  const parsed = reportDefinitionSchema.safeParse({ ...(raw && typeof raw === "object" ? raw : {}), dataset });
  return parsed.success ? parsed.data : reportDefinitionSchema.parse({ dataset });
}

export type ReportSheet = { name: string; rows: Array<Array<string | number>> };

/** Rakit sheet XLSX: satu sheet data + satu sheet info definisi. */
export function buildReportSheets(
  report: { name: string; description?: string | null },
  definition: ReportDefinition,
  result: ReportResult,
  generatedAt: Date = new Date()
): ReportSheet[] {
  const header = result.columns.map((c) => c.label);
  const body = result.rows.map((row) =>
    result.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return "";
      if (c.type === "number" || c.type === "currency") return Number(v) || 0;
      return formatCellValue(c.type, v);
    })
  );
  const ds = datasetDef(definition.dataset);
  const info: Array<Array<string | number>> = [
    ["Report", report.name],
    ["Deskripsi", report.description ?? "—"],
    ["Dataset", ds.label],
    ["Periode", definition.date_preset === "custom" ? `${definition.date_from ?? "?"} s/d ${definition.date_to ?? "?"}` : definition.date_preset],
    ["Mode", result.grouped ? "Agregasi" : "Tabel"],
    ["Jumlah baris", result.row_count],
    ["Dibuat", formatDateTime(generatedAt)],
  ];
  if (result.truncated) info.push(["Catatan", `Dipotong pada batas ${definition.limit} baris`]);
  return [
    { name: "Data", rows: [header, ...body] },
    { name: "Info", rows: info },
  ];
}

export function reportFileName(name: string, generatedAt: Date = new Date()): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "report";
  return `${slug}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
}
