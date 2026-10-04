/**
 * EPIC-050 Fase 4 (T-4.1) — report builder generik, bagian murni.
 * Berbeda dari reports.ts (laporan CRM tetap EPIC-011): file ini mendefinisikan
 * dataset + pembangun SQL untuk report yang dirakit pengguna.
 *
 * Keamanan: seluruh potongan SQL (tabel, join, ekspresi kolom) berasal dari
 * registry di file ini. Input pengguna hanya memilih KUNCI field; nilai filter
 * selalu lewat parameter ($n). Tidak ada string pengguna yang masuk ke SQL.
 */
import { z } from "zod";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";

// ── dataset ────────────────────────────────────────────────────────────────
export const REPORT_DATASETS = ["lead", "deal", "quotation", "task", "account", "contact"] as const;
export type ReportDataset = (typeof REPORT_DATASETS)[number];

export type ReportFieldType = "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "enum";

export interface ReportFieldDef {
  label: string;
  type: ReportFieldType;
  /** Ekspresi SQL aman (hanya dari file ini). */
  sql: string;
  options?: readonly string[];
  /** Boleh dipakai sebagai target sum/avg/min/max. */
  aggregatable?: boolean;
}

export interface ReportDatasetDef {
  label: string;
  /** FROM + JOIN; alias tabel utama selalu `t`. */
  from: string;
  /** Kondisi dasar (soft delete dll). */
  baseWhere: string;
  companyExpr: string;
  /** Kolom penanggung jawab untuk pembatasan role sales; null = tanpa batas. */
  ownerExpr: string | null;
  /** Field tanggal utama untuk filter periode cepat. */
  dateField: string;
  fields: Record<string, ReportFieldDef>;
  defaultColumns: readonly string[];
}

/** Nilai enum mengikuti CHECK constraint di database (bahasa Indonesia). */
const ORG_TYPES = ["corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"] as const;

const OWNER_JOIN = "LEFT JOIN configuration.users ou ON ou.id = t.owner_user_id";

export const REPORT_DATASET_DEFS: Record<ReportDataset, ReportDatasetDef> = {
  lead: {
    label: "Lead",
    from: `crm.crm_sales_leads t
      ${OWNER_JOIN}
      LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "t.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["org_name", "status", "temperature", "source", "score", "owner_name", "created_at"],
    fields: {
      org_name: { label: "Instansi", type: "text", sql: "t.org_name" },
      org_type: { label: "Tipe Instansi", type: "enum", sql: "t.org_type", options: ORG_TYPES },
      pic_name: { label: "Nama PIC", type: "text", sql: "t.pic_name" },
      pic_phone: { label: "Telepon PIC", type: "text", sql: "t.pic_phone" },
      pic_email: { label: "Email PIC", type: "text", sql: "t.pic_email" },
      city: { label: "Kota", type: "text", sql: "t.city" },
      source: { label: "Sumber", type: "enum", sql: "t.source", options: ["wa", "instagram", "referral", "google", "pameran", "canvassing", "lainnya"] },
      temperature: { label: "Temperatur", type: "enum", sql: "t.temperature", options: ["panas", "hangat", "dingin"] },
      status: { label: "Status", type: "enum", sql: "t.status", options: ["baru", "dihubungi", "qualified", "tidak-cocok"] },
      score: { label: "Skor", type: "number", sql: "t.score", aggregatable: true },
      account_name: { label: "Account", type: "text", sql: "ac.name" },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      utm_source: { label: "UTM Source", type: "text", sql: "t.utm_source" },
      utm_medium: { label: "UTM Medium", type: "text", sql: "t.utm_medium" },
      utm_campaign: { label: "UTM Campaign", type: "text", sql: "t.utm_campaign" },
      utm_content: { label: "UTM Content", type: "text", sql: "t.utm_content" },
      utm_term: { label: "UTM Term", type: "text", sql: "t.utm_term" },
      landing_page: { label: "Halaman Masuk", type: "text", sql: "t.landing_page" },
      referrer: { label: "Referrer", type: "text", sql: "t.referrer" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
      updated_at: { label: "Diperbarui", type: "datetime", sql: "t.updated_at" },
    },
  },
  deal: {
    label: "Deal",
    from: `crm.crm_sales_deals t
      ${OWNER_JOIN}
      JOIN crm.crm_sales_leads l ON l.id = t.lead_id
      JOIN crm.crm_sales_stages s ON s.id = t.stage_id
      LEFT JOIN crm.crm_pipelines p ON p.id = t.pipeline_id
      LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = t.lost_reason_id`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "t.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["title", "org_name", "stage_name", "value", "forecast_category", "owner_name", "event_date"],
    fields: {
      title: { label: "Judul Deal", type: "text", sql: "t.title" },
      org_name: { label: "Instansi", type: "text", sql: "l.org_name" },
      pipeline_name: { label: "Pipeline", type: "text", sql: "p.name" },
      stage_name: { label: "Tahap", type: "text", sql: "s.name" },
      probability: { label: "Probability (%)", type: "number", sql: "s.probability", aggregatable: true },
      forecast_category: { label: "Kategori Forecast", type: "enum", sql: "t.forecast_category", options: ["pipeline", "best_case", "commit", "closed_won", "closed_lost"] },
      event_type: { label: "Jenis Acara", type: "enum", sql: "t.event_type", options: ["gathering", "field-trip", "ulang-tahun", "buyout-venue", "lainnya"] },
      value: { label: "Nilai Deal", type: "currency", sql: "COALESCE(t.value_final, t.value_estimate, 0)", aggregatable: true },
      value_estimate: { label: "Nilai Estimasi", type: "currency", sql: "COALESCE(t.value_estimate, 0)", aggregatable: true },
      value_final: { label: "Nilai Final", type: "currency", sql: "COALESCE(t.value_final, 0)", aggregatable: true },
      weighted_value: { label: "Nilai Tertimbang", type: "currency", sql: "ROUND(COALESCE(t.value_final, t.value_estimate, 0) * COALESCE(s.probability, 0) / 100.0)", aggregatable: true },
      pax_estimate: { label: "Estimasi Pax", type: "number", sql: "t.pax_estimate", aggregatable: true },
      is_won: { label: "Menang", type: "boolean", sql: "s.is_won" },
      is_lost: { label: "Kalah", type: "boolean", sql: "s.is_lost" },
      lost_reason: { label: "Alasan Kalah", type: "text", sql: "lr.name" },
      age_days: { label: "Umur Deal (hari)", type: "number", sql: "GREATEST(0, (CURRENT_DATE - t.created_at::date))", aggregatable: true },
      days_in_stage: { label: "Hari di Tahap", type: "number", sql: "GREATEST(0, (CURRENT_DATE - COALESCE(t.entered_stage_at, t.created_at)::date))", aggregatable: true },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      lead_source: { label: "Sumber Lead", type: "enum", sql: "l.source", options: ["wa", "instagram", "referral", "google", "pameran", "canvassing", "lainnya"] },
      utm_source: { label: "UTM Source", type: "text", sql: "l.utm_source" },
      utm_medium: { label: "UTM Medium", type: "text", sql: "l.utm_medium" },
      utm_campaign: { label: "UTM Campaign", type: "text", sql: "l.utm_campaign" },
      event_date: { label: "Tanggal Acara", type: "date", sql: "t.event_date" },
      closed_at: { label: "Ditutup", type: "datetime", sql: "t.closed_at" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
    },
  },
  quotation: {
    label: "Quotation",
    from: `crm.crm_sales_quotations t
      JOIN crm.crm_sales_deals d ON d.id = t.deal_id
      JOIN crm.crm_sales_leads l ON l.id = d.lead_id
      LEFT JOIN configuration.users ou ON ou.id = d.owner_user_id`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "d.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["quote_number", "org_name", "status", "total", "discount_percent", "approval_status", "created_at"],
    fields: {
      quote_number: { label: "Nomor", type: "text", sql: "t.quote_number" },
      deal_title: { label: "Deal", type: "text", sql: "d.title" },
      org_name: { label: "Instansi", type: "text", sql: "l.org_name" },
      status: { label: "Status", type: "enum", sql: "t.status", options: ["draft", "terkirim", "diterima", "ditolak", "superseded"] },
      approval_status: { label: "Status Approval", type: "enum", sql: "t.approval_status", options: ["none", "pending", "approved", "rejected"] },
      version: { label: "Versi", type: "number", sql: "t.version", aggregatable: true },
      subtotal: { label: "Subtotal", type: "currency", sql: "COALESCE(t.subtotal, 0)", aggregatable: true },
      discount_percent: { label: "Diskon (%)", type: "number", sql: "COALESCE(t.discount_percent, 0)", aggregatable: true },
      discount_nominal: { label: "Diskon (Rp)", type: "currency", sql: "COALESCE(t.discount_nominal, 0)", aggregatable: true },
      ppn_nominal: { label: "PPN", type: "currency", sql: "COALESCE(t.ppn_nominal, 0)", aggregatable: true },
      total: { label: "Total", type: "currency", sql: "COALESCE(t.total, 0)", aggregatable: true },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      valid_until: { label: "Berlaku Sampai", type: "date", sql: "t.valid_until" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
    },
  },
  task: {
    label: "Task & Aktivitas",
    from: `crm.crm_sales_activities t
      ${OWNER_JOIN}
      LEFT JOIN crm.crm_sales_leads l ON l.id = t.lead_id
      LEFT JOIN crm.crm_sales_deals d ON d.id = t.deal_id`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "t.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["title", "activity_type", "status", "priority", "owner_name", "due_at"],
    fields: {
      title: { label: "Judul", type: "text", sql: "COALESCE(t.title, t.notes)" },
      activity_type: { label: "Jenis", type: "enum", sql: "t.activity_type", options: ["telepon", "wa", "meeting", "catatan", "tugas", "email"] },
      status: { label: "Status", type: "enum", sql: "t.status", options: ["open", "in_progress", "done", "cancelled"] },
      priority: { label: "Prioritas", type: "enum", sql: "t.priority", options: ["low", "normal", "high", "urgent"] },
      subject_type: { label: "Terkait", type: "enum", sql: "t.subject_type", options: ["lead", "deal", "account", "contact", "member"] },
      org_name: { label: "Instansi", type: "text", sql: "l.org_name" },
      deal_title: { label: "Deal", type: "text", sql: "d.title" },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      is_overdue: { label: "Terlambat", type: "boolean", sql: "(t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < now())" },
      due_at: { label: "Jatuh Tempo", type: "datetime", sql: "t.due_at" },
      done_at: { label: "Selesai", type: "datetime", sql: "t.done_at" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
    },
  },
  account: {
    label: "Account",
    from: `crm.crm_accounts t ${OWNER_JOIN}`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "t.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["name", "account_type", "industry", "city", "owner_name", "created_at"],
    fields: {
      name: { label: "Nama Account", type: "text", sql: "t.name" },
      account_type: { label: "Tipe", type: "enum", sql: "t.account_type", options: ORG_TYPES },
      industry: { label: "Industri", type: "text", sql: "t.industry" },
      city: { label: "Kota", type: "text", sql: "t.city" },
      phone: { label: "Telepon", type: "text", sql: "t.phone" },
      email: { label: "Email", type: "text", sql: "t.email" },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
    },
  },
  contact: {
    label: "Contact",
    from: `crm.crm_contacts t
      ${OWNER_JOIN}
      LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id`,
    baseWhere: "t.deleted_at IS NULL",
    companyExpr: "t.company_id",
    ownerExpr: "t.owner_user_id",
    dateField: "created_at",
    defaultColumns: ["name", "title", "account_name", "phone", "email", "created_at"],
    fields: {
      name: { label: "Nama", type: "text", sql: "t.name" },
      title: { label: "Jabatan", type: "text", sql: "t.title" },
      account_name: { label: "Account", type: "text", sql: "ac.name" },
      phone: { label: "Telepon", type: "text", sql: "t.phone" },
      email: { label: "Email", type: "text", sql: "t.email" },
      is_primary: { label: "PIC Utama", type: "boolean", sql: "t.is_primary" },
      owner_name: { label: "Penanggung Jawab", type: "text", sql: "ou.full_name" },
      created_at: { label: "Dibuat", type: "datetime", sql: "t.created_at" },
    },
  },
};

// ── definisi report ────────────────────────────────────────────────────────
export const FILTER_OPS = ["eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: "sama dengan",
  neq: "tidak sama dengan",
  in: "salah satu dari",
  not_in: "bukan salah satu dari",
  contains: "mengandung",
  gt: "lebih dari",
  gte: "minimal",
  lt: "kurang dari",
  lte: "maksimal",
  between: "antara",
  is_empty: "kosong",
  not_empty: "terisi",
};

/** Rentang tanggal relatif — dihitung saat report dijalankan, bukan saat disimpan. */
export const DATE_PRESETS = [
  "all_time", "today", "yesterday", "last_7_days", "last_30_days",
  "this_month", "last_month", "this_quarter", "this_year", "last_year", "custom",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all_time: "Semua waktu",
  today: "Hari ini",
  yesterday: "Kemarin",
  last_7_days: "7 hari terakhir",
  last_30_days: "30 hari terakhir",
  this_month: "Bulan ini",
  last_month: "Bulan lalu",
  this_quarter: "Kuartal ini",
  this_year: "Tahun ini",
  last_year: "Tahun lalu",
  custom: "Rentang khusus",
};

export const AGGREGATIONS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: "Jumlah baris",
  count_distinct: "Jumlah unik",
  sum: "Total",
  avg: "Rata-rata",
  min: "Minimum",
  max: "Maksimum",
};

export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  day: "Harian", week: "Mingguan", month: "Bulanan", quarter: "Kuartalan", year: "Tahunan",
};

export const CHART_TYPES = ["table", "bar", "column", "line", "area", "pie", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  table: "Tabel", bar: "Batang (horizontal)", column: "Batang (vertikal)",
  line: "Garis", area: "Area", pie: "Pie", donut: "Donut",
};

export const reportFilterSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional().nullable(),
  /** Nilai kedua untuk op "between". */
  value2: z.unknown().optional().nullable(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const reportAggregateSchema = z.object({
  fn: z.enum(AGGREGATIONS),
  /** Wajib kecuali fn = count. */
  field: z.string().trim().max(60).optional().nullable(),
  label: z.string().trim().max(80).optional().nullable(),
});
export type ReportAggregate = z.infer<typeof reportAggregateSchema>;

export const reportDefinitionSchema = z.object({
  dataset: z.enum(REPORT_DATASETS),
  columns: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  filters: z.array(reportFilterSchema).max(20).default([]),
  date_field: z.string().trim().max(60).optional().nullable(),
  date_preset: z.enum(DATE_PRESETS).default("all_time"),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  group_by: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
  date_bucket: z.enum(DATE_BUCKETS).default("month"),
  aggregates: z.array(reportAggregateSchema).max(6).default([]),
  sort_field: z.string().trim().max(60).optional().nullable(),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(5000).default(500),
  chart_type: z.enum(CHART_TYPES).default("table"),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const reportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  definition: reportDefinitionSchema,
  is_shared: z.boolean().default(true),
});
export type ReportInput = z.infer<typeof reportSchema>;

// ── helper ─────────────────────────────────────────────────────────────────
export function datasetDef(dataset: ReportDataset): ReportDatasetDef {
  return REPORT_DATASET_DEFS[dataset];
}

export function fieldDef(dataset: ReportDataset, key: string): ReportFieldDef | null {
  return REPORT_DATASET_DEFS[dataset].fields[key] ?? null;
}

/** Label kolom hasil agregasi, mis. sum(value) → "Total Nilai Deal". */
export function aggregateKey(agg: ReportAggregate): string {
  return agg.fn === "count" ? "count" : `${agg.fn}_${agg.field ?? ""}`;
}

export function aggregateLabel(dataset: ReportDataset, agg: ReportAggregate): string {
  if (agg.label) return agg.label;
  if (agg.fn === "count") return "Jumlah";
  const f = fieldDef(dataset, agg.field ?? "");
  return `${AGGREGATION_LABELS[agg.fn]} ${f?.label ?? agg.field ?? ""}`.trim();
}

/**
 * Rentang tanggal dari preset. `today` dipakai sebagai "hari ini" agar bisa diuji.
 * Mengembalikan [from, to) — `to` eksklusif.
 */
export function resolveDateRange(
  preset: DatePreset,
  custom: { from?: string | null; to?: string | null },
  today: Date = new Date()
): { from: string; to: string } | null {
  const d = (y: number, m: number, day: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const day = today.getDate();
  const plusDays = (base: Date, n: number) => {
    const x = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
    return d(x.getFullYear(), x.getMonth() + 1, x.getDate());
  };
  switch (preset) {
    case "all_time":
      return null;
    case "today":
      return { from: d(y, m, day), to: plusDays(today, 1) };
    case "yesterday":
      return { from: plusDays(today, -1), to: d(y, m, day) };
    case "last_7_days":
      return { from: plusDays(today, -6), to: plusDays(today, 1) };
    case "last_30_days":
      return { from: plusDays(today, -29), to: plusDays(today, 1) };
    case "this_month":
      return { from: d(y, m, 1), to: m === 12 ? d(y + 1, 1, 1) : d(y, m + 1, 1) };
    case "last_month":
      return { from: m === 1 ? d(y - 1, 12, 1) : d(y, m - 1, 1), to: d(y, m, 1) };
    case "this_quarter": {
      const q = Math.floor((m - 1) / 3);
      const startMonth = q * 3 + 1;
      return { from: d(y, startMonth, 1), to: startMonth + 3 > 12 ? d(y + 1, 1, 1) : d(y, startMonth + 3, 1) };
    }
    case "this_year":
      return { from: d(y, 1, 1), to: d(y + 1, 1, 1) };
    case "last_year":
      return { from: d(y - 1, 1, 1), to: d(y, 1, 1) };
    case "custom":
      if (!custom.from || !custom.to) return null;
      return { from: custom.from, to: custom.to };
  }
}

export interface BuildReportContext {
  companyId: string | null;
  /** Bila diisi, hasil dibatasi ke record milik user ini (role sales). */
  restrictOwnerUserId?: string | null;
  today?: Date;
}

export interface BuiltReport {
  sql: string;
  params: unknown[];
  /** Kolom hasil, urut sesuai SELECT. */
  columns: Array<{ key: string; label: string; type: ReportFieldType | "number"; isAggregate: boolean }>;
  grouped: boolean;
}

function castValue(type: ReportFieldType, v: unknown): unknown {
  if (type === "number" || type === "currency") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return v === true || v === "true" || v === 1 || v === "1";
  return v === null || v === undefined ? null : String(v);
}

function filterSql(
  dataset: ReportDataset,
  f: ReportFilter,
  params: unknown[]
): string | null {
  const def = fieldDef(dataset, f.field);
  if (!def) return null;
  const col = def.sql;
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  switch (f.op) {
    case "is_empty":
      return `(${col} IS NULL${def.type === "text" ? ` OR ${col} = ''` : ""})`;
    case "not_empty":
      return `(${col} IS NOT NULL${def.type === "text" ? ` AND ${col} <> ''` : ""})`;
    case "contains":
      return `${col} ILIKE ${push(`%${String(f.value ?? "")}%`)}`;
    case "in":
    case "not_in": {
      const arr = (Array.isArray(f.value) ? f.value : [f.value]).filter((v) => v !== null && v !== undefined && v !== "");
      if (arr.length === 0) return null;
      return `${col}${f.op === "not_in" ? " NOT" : ""} = ANY(${push(arr.map((v) => castValue(def.type, v)))})`;
    }
    case "between": {
      if (f.value === null || f.value === undefined || f.value2 === null || f.value2 === undefined) return null;
      return `${col} BETWEEN ${push(castValue(def.type, f.value))} AND ${push(castValue(def.type, f.value2))}`;
    }
    default: {
      const opSql = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
      if (f.value === null || f.value === undefined || f.value === "") {
        return f.op === "eq" ? `${col} IS NULL` : f.op === "neq" ? `${col} IS NOT NULL` : null;
      }
      return `${col} ${opSql} ${push(castValue(def.type, f.value))}`;
    }
  }
}

function bucketSql(expr: string, bucket: DateBucket): string {
  return `date_trunc('${bucket}', ${expr})::date`;
}

function aggSql(dataset: ReportDataset, agg: ReportAggregate): string | null {
  if (agg.fn === "count") return "COUNT(*)::numeric";
  const def = fieldDef(dataset, agg.field ?? "");
  if (!def) return null;
  if (agg.fn === "count_distinct") return `COUNT(DISTINCT ${def.sql})::numeric`;
  if (!def.aggregatable && (agg.fn === "sum" || agg.fn === "avg")) return null;
  const fn = agg.fn.toUpperCase();
  return `${fn === "AVG" ? `ROUND(AVG(${def.sql})::numeric, 2)` : `${fn}(${def.sql})::numeric`}`;
}

/**
 * Bangun SQL report. Semua identifier berasal dari registry; nilai lewat params.
 * Mode tabel (tanpa group_by) atau mode agregasi (dengan group_by).
 */
export function buildReportQuery(def: ReportDefinition, ctx: BuildReportContext): BuiltReport {
  const ds = datasetDef(def.dataset);
  const params: unknown[] = [];
  const where: string[] = [ds.baseWhere];

  if (ctx.companyId) {
    params.push(ctx.companyId);
    where.push(`${ds.companyExpr} = $${params.length}`);
  }
  if (ctx.restrictOwnerUserId && ds.ownerExpr) {
    params.push(ctx.restrictOwnerUserId);
    where.push(`${ds.ownerExpr} = $${params.length}`);
  }

  const dateKey = def.date_field && fieldDef(def.dataset, def.date_field) ? def.date_field : ds.dateField;
  const dateCol = fieldDef(def.dataset, dateKey);
  const range = resolveDateRange(def.date_preset, { from: def.date_from, to: def.date_to }, ctx.today);
  if (range && dateCol) {
    params.push(range.from);
    where.push(`${dateCol.sql} >= $${params.length}::date`);
    params.push(range.to);
    where.push(`${dateCol.sql} < $${params.length}::date`);
  }
  for (const f of def.filters) {
    const sql = filterSql(def.dataset, f, params);
    if (sql) where.push(sql);
  }

  const grouped = def.group_by.length > 0;
  const columns: BuiltReport["columns"] = [];
  const select: string[] = [];

  if (grouped) {
    const groupExprs: string[] = [];
    for (const key of def.group_by) {
      const fd = fieldDef(def.dataset, key);
      if (!fd) continue;
      const isDate = fd.type === "date" || fd.type === "datetime";
      const expr = isDate ? bucketSql(fd.sql, def.date_bucket) : fd.sql;
      groupExprs.push(expr);
      select.push(`${expr} AS "${key}"`);
      columns.push({ key, label: isDate ? `${fd.label} (${DATE_BUCKET_LABELS[def.date_bucket]})` : fd.label, type: isDate ? "date" : fd.type, isAggregate: false });
    }
    const aggs = def.aggregates.length > 0 ? def.aggregates : [{ fn: "count" as const, field: null, label: null }];
    for (const agg of aggs) {
      const sql = aggSql(def.dataset, agg);
      if (!sql) continue;
      const key = aggregateKey(agg);
      select.push(`${sql} AS "${key}"`);
      const target = agg.field ? fieldDef(def.dataset, agg.field) : null;
      columns.push({
        key,
        label: aggregateLabel(def.dataset, agg),
        type: agg.fn === "count" || agg.fn === "count_distinct" ? "number" : target?.type ?? "number",
        isAggregate: true,
      });
    }
    if (groupExprs.length === 0 || columns.length === 0) {
      // group_by tidak valid → jatuh ke hitung total saja
      return buildReportQuery({ ...def, group_by: [] }, ctx);
    }
    const sortCol = def.sort_field && columns.some((c) => c.key === def.sort_field)
      ? `"${def.sort_field}"`
      : `"${columns.find((c) => c.isAggregate)?.key ?? columns[0].key}"`;
    const sql = `SELECT ${select.join(", ")}
      FROM ${ds.from}
      WHERE ${where.join(" AND ")}
      GROUP BY ${groupExprs.join(", ")}
      ORDER BY ${sortCol} ${def.sort_dir === "asc" ? "ASC" : "DESC"} NULLS LAST
      LIMIT ${def.limit}`;
    return { sql, params, columns, grouped: true };
  }

  const cols = def.columns.length > 0 ? def.columns : [...ds.defaultColumns];
  for (const key of cols) {
    const fd = fieldDef(def.dataset, key);
    if (!fd) continue;
    select.push(`${fd.sql} AS "${key}"`);
    columns.push({ key, label: fd.label, type: fd.type, isAggregate: false });
  }
  if (select.length === 0) {
    const fallback = ds.defaultColumns[0];
    const fd = fieldDef(def.dataset, fallback)!;
    select.push(`${fd.sql} AS "${fallback}"`);
    columns.push({ key: fallback, label: fd.label, type: fd.type, isAggregate: false });
  }
  const sortFd = def.sort_field ? fieldDef(def.dataset, def.sort_field) : null;
  const sortExpr = sortFd ? sortFd.sql : (dateCol?.sql ?? select[0].split(" AS ")[0]);
  const sql = `SELECT ${select.join(", ")}
    FROM ${ds.from}
    WHERE ${where.join(" AND ")}
    ORDER BY ${sortExpr} ${def.sort_dir === "asc" ? "ASC" : "DESC"} NULLS LAST
    LIMIT ${def.limit}`;
  return { sql, params, columns, grouped: false };
}

/** Ringkasan satu baris untuk pesan WA / kartu dashboard. */
export function summarizeRows(
  rows: Array<Record<string, unknown>>,
  columns: BuiltReport["columns"]
): string {
  if (rows.length === 0) return "Tidak ada data.";
  const agg = columns.filter((c) => c.isAggregate);
  if (agg.length === 0) return `${rows.length} baris.`;
  const labelCol = columns.find((c) => !c.isAggregate);
  const top = rows.slice(0, 5).map((r) => {
    const label = labelCol ? String(r[labelCol.key] ?? "—") : "—";
    const vals = agg.map((a) => `${a.label}: ${formatCellValue(a.type, r[a.key])}`).join(", ");
    return `• ${label} — ${vals}`;
  });
  return top.join("\n") + (rows.length > 5 ? `\n… dan ${rows.length - 5} baris lain.` : "");
}

export function formatCellValue(type: ReportFieldType | "number", v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "currency":
      return formatRupiah(Number(v) || 0);
    case "number":
      return formatNumber(Number(v), 3);
    case "boolean":
      return v === true || v === "true" ? "Ya" : "Tidak";
    case "date":
      return formatDate(String(v));
    case "datetime":
      return formatDateTime(String(v));
    default:
      return String(v);
  }
}
