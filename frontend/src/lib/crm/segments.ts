/**
 * EPIC-050 Fase 5 (T-5.1) — segmen dinamis + RFM, bagian murni.
 *
 * Keamanan mengikuti report-builder: seluruh ekspresi SQL berasal dari registry
 * di file ini; pengguna hanya memilih KUNCI field dan nilai selalu lewat
 * parameter ($n).
 *
 * RFM memakai NTILE(5) atas populasi terpilih, jadi skor bersifat relatif:
 * 5 selalu berarti "terbaik" (paling baru berkunjung, paling sering, paling
 * besar belanjanya). Ambang tetap tidak dipakai supaya segmen tetap masuk akal
 * saat jumlah member tumbuh.
 */
import { z } from "zod";
import { FILTER_OPS, type FilterOp } from "./report-builder";

export const SEGMENT_SOURCES = ["member", "lead", "contact"] as const;
export type SegmentSource = (typeof SEGMENT_SOURCES)[number];

export const SEGMENT_SOURCE_LABELS: Record<SegmentSource, string> = {
  member: "Member & Pelanggan",
  lead: "Lead",
  contact: "Contact",
};

export type SegmentFieldType = "text" | "number" | "currency" | "date" | "boolean" | "enum";

export interface SegmentFieldDef {
  label: string;
  type: SegmentFieldType;
  sql: string;
  options?: readonly string[];
}

export interface SegmentSourceDef {
  label: string;
  from: string;
  baseWhere: string;
  /** Kolom identitas untuk daftar & pengiriman kampanye. */
  idExpr: string;
  nameExpr: string;
  phoneExpr: string;
  /** null = tabel tidak punya company_id (mis. pos_customers dipakai lintas venue). */
  companyExpr: string | null;
  /** Hanya `member` yang mendukung RFM. */
  supportsRfm: boolean;
  fields: Record<string, SegmentFieldDef>;
}

export const SEGMENT_SOURCE_DEFS: Record<SegmentSource, SegmentSourceDef> = {
  member: {
    label: "Member & Pelanggan",
    from: "pos.pos_customers t",
    baseWhere: "t.is_active",
    idExpr: "t.id",
    nameExpr: "COALESCE(t.name, 'Tanpa nama')",
    phoneExpr: "t.phone",
    companyExpr: null,
    supportsRfm: true,
    fields: {
      name: { label: "Nama", type: "text", sql: "t.name" },
      phone: { label: "Telepon", type: "text", sql: "t.phone" },
      email: { label: "Email", type: "text", sql: "t.email" },
      city: { label: "Kota", type: "text", sql: "t.city" },
      gender: { label: "Jenis Kelamin", type: "enum", sql: "t.gender", options: ["male", "female", "other"] },
      membership_tier: { label: "Tier", type: "text", sql: "t.membership_tier" },
      member_type: { label: "Tipe Member", type: "text", sql: "t.member_type" },
      total_spent: { label: "Total Belanja", type: "currency", sql: "COALESCE(t.total_spent, 0)" },
      visit_count: { label: "Jumlah Kunjungan", type: "number", sql: "COALESCE(t.visit_count, 0)" },
      ark_coin_balance: { label: "Saldo ARK", type: "currency", sql: "COALESCE(t.ark_coin_balance, 0)" },
      total_xp: { label: "Total XP", type: "number", sql: "COALESCE(t.total_xp, 0)" },
      recency_days: { label: "Hari Sejak Kunjungan Terakhir", type: "number", sql: "GREATEST(0, (CURRENT_DATE - t.last_visit::date))" },
      last_visit: { label: "Kunjungan Terakhir", type: "date", sql: "t.last_visit" },
      wa_consent: { label: "Izin WhatsApp", type: "boolean", sql: "COALESCE(t.wa_consent, false)" },
      created_at: { label: "Terdaftar", type: "date", sql: "t.created_at" },
    },
  },
  lead: {
    label: "Lead",
    from: "crm.crm_sales_leads t",
    baseWhere: "t.deleted_at IS NULL",
    idExpr: "t.id",
    nameExpr: "t.org_name",
    phoneExpr: "t.pic_phone",
    companyExpr: "t.company_id",
    supportsRfm: false,
    fields: {
      org_name: { label: "Instansi", type: "text", sql: "t.org_name" },
      pic_name: { label: "Nama PIC", type: "text", sql: "t.pic_name" },
      city: { label: "Kota", type: "text", sql: "t.city" },
      org_type: { label: "Tipe Instansi", type: "enum", sql: "t.org_type", options: ["corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"] },
      source: { label: "Sumber", type: "enum", sql: "t.source", options: ["wa", "instagram", "referral", "google", "pameran", "canvassing", "lainnya"] },
      temperature: { label: "Temperatur", type: "enum", sql: "t.temperature", options: ["panas", "hangat", "dingin"] },
      status: { label: "Status", type: "enum", sql: "t.status", options: ["baru", "dihubungi", "qualified", "tidak-cocok"] },
      score: { label: "Skor", type: "number", sql: "COALESCE(t.score, 0)" },
      utm_source: { label: "UTM Source", type: "text", sql: "t.utm_source" },
      utm_campaign: { label: "UTM Campaign", type: "text", sql: "t.utm_campaign" },
      created_at: { label: "Dibuat", type: "date", sql: "t.created_at" },
    },
  },
  contact: {
    label: "Contact",
    from: "crm.crm_contacts t LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id",
    baseWhere: "t.deleted_at IS NULL",
    idExpr: "t.id",
    nameExpr: "t.name",
    phoneExpr: "t.phone",
    companyExpr: "t.company_id",
    supportsRfm: false,
    fields: {
      name: { label: "Nama", type: "text", sql: "t.name" },
      title: { label: "Jabatan", type: "text", sql: "t.title" },
      account_name: { label: "Account", type: "text", sql: "ac.name" },
      account_type: { label: "Tipe Account", type: "enum", sql: "ac.account_type", options: ["corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"] },
      city: { label: "Kota", type: "text", sql: "ac.city" },
      is_primary: { label: "PIC Utama", type: "boolean", sql: "t.is_primary" },
      created_at: { label: "Dibuat", type: "date", sql: "t.created_at" },
    },
  },
};

// ── RFM ────────────────────────────────────────────────────────────────────
/** Skor 1–5 per dimensi; 5 selalu berarti paling baik. */
export const RFM_DIMENSIONS = ["recency", "frequency", "monetary"] as const;
export type RfmDimension = (typeof RFM_DIMENSIONS)[number];

export const RFM_DIMENSION_LABELS: Record<RfmDimension, string> = {
  recency: "Recency (kebaruan kunjungan)",
  frequency: "Frequency (jumlah kunjungan)",
  monetary: "Monetary (total belanja)",
};

export const rfmRangeSchema = z.object({
  min: z.number().int().min(1).max(5).default(1),
  max: z.number().int().min(1).max(5).default(5),
});

export const rfmSchema = z.object({
  enabled: z.boolean().default(false),
  recency: rfmRangeSchema.default({ min: 1, max: 5 }),
  frequency: rfmRangeSchema.default({ min: 1, max: 5 }),
  monetary: rfmRangeSchema.default({ min: 1, max: 5 }),
});
export type RfmFilter = z.infer<typeof rfmSchema>;

/** Preset RFM siap pakai — nama mengikuti istilah umum agar mudah dikenali. */
export const RFM_PRESETS: Record<string, { label: string; description: string; rfm: RfmFilter }> = {
  champions: {
    label: "Champions",
    description: "Baru berkunjung, sering, belanja besar. Prioritas utama program loyalitas.",
    rfm: { enabled: true, recency: { min: 4, max: 5 }, frequency: { min: 4, max: 5 }, monetary: { min: 4, max: 5 } },
  },
  loyal: {
    label: "Loyal",
    description: "Sering datang dengan belanja di atas rata-rata.",
    rfm: { enabled: true, recency: { min: 3, max: 5 }, frequency: { min: 4, max: 5 }, monetary: { min: 3, max: 5 } },
  },
  big_spender: {
    label: "Belanja Besar",
    description: "Nilai belanja tertinggi, seberapa pun frekuensinya.",
    rfm: { enabled: true, recency: { min: 1, max: 5 }, frequency: { min: 1, max: 5 }, monetary: { min: 5, max: 5 } },
  },
  at_risk: {
    label: "Berisiko Hilang",
    description: "Dulu sering dan besar, tapi sudah lama tidak datang.",
    rfm: { enabled: true, recency: { min: 1, max: 2 }, frequency: { min: 3, max: 5 }, monetary: { min: 3, max: 5 } },
  },
  hibernating: {
    label: "Tidur",
    description: "Lama tidak datang, frekuensi dan belanja rendah.",
    rfm: { enabled: true, recency: { min: 1, max: 2 }, frequency: { min: 1, max: 2 }, monetary: { min: 1, max: 2 } },
  },
  new: {
    label: "Baru",
    description: "Baru berkunjung tapi belum sering.",
    rfm: { enabled: true, recency: { min: 4, max: 5 }, frequency: { min: 1, max: 2 }, monetary: { min: 1, max: 5 } },
  },
};

// ── definisi segmen ────────────────────────────────────────────────────────
export const segmentFilterSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional().nullable(),
  value2: z.unknown().optional().nullable(),
});
export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

export const segmentDefinitionSchema = z.object({
  source: z.enum(SEGMENT_SOURCES),
  filters: z.array(segmentFilterSchema).max(20).default([]),
  rfm: rfmSchema.default({ enabled: false, recency: { min: 1, max: 5 }, frequency: { min: 1, max: 5 }, monetary: { min: 1, max: 5 } }),
  /** Hanya yang mengizinkan WA — dipakai saat segmen jadi penerima kampanye. */
  require_wa_consent: z.boolean().default(false),
  limit: z.number().int().min(1).max(50_000).default(5000),
});
export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

export const segmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  definition: segmentDefinitionSchema,
  is_active: z.boolean().default(true),
});
export type SegmentInput = z.infer<typeof segmentSchema>;

export function segmentSourceDef(source: SegmentSource): SegmentSourceDef {
  return SEGMENT_SOURCE_DEFS[source];
}

export function segmentFieldDef(source: SegmentSource, key: string): SegmentFieldDef | null {
  return SEGMENT_SOURCE_DEFS[source].fields[key] ?? null;
}

function castValue(type: SegmentFieldType, v: unknown): unknown {
  if (type === "number" || type === "currency") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return v === true || v === "true" || v === 1 || v === "1";
  return v === null || v === undefined ? null : String(v);
}

function filterSql(source: SegmentSource, f: SegmentFilter, params: unknown[]): string | null {
  const def = segmentFieldDef(source, f.field);
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
      const opSql: Record<Exclude<FilterOp, "is_empty" | "not_empty" | "contains" | "in" | "not_in" | "between">, string> = {
        eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
      };
      if (f.value === null || f.value === undefined || f.value === "") {
        return f.op === "eq" ? `${col} IS NULL` : f.op === "neq" ? `${col} IS NOT NULL` : null;
      }
      return `${col} ${opSql[f.op]} ${push(castValue(def.type, f.value))}`;
    }
  }
}

export interface BuildSegmentContext {
  companyId: string | null;
  /** true = hanya hitung jumlah baris (untuk pratinjau). */
  countOnly?: boolean;
}

export interface BuiltSegment {
  sql: string;
  params: unknown[];
  withRfm: boolean;
}

/**
 * Bangun query segmen. Tanpa RFM hasilnya query sederhana; dengan RFM,
 * skor dihitung lewat NTILE(5) atas populasi hasil filter lalu disaring.
 */
export function buildSegmentQuery(def: SegmentDefinition, ctx: BuildSegmentContext): BuiltSegment {
  const src = segmentSourceDef(def.source);
  const params: unknown[] = [];
  const where: string[] = [src.baseWhere];

  if (ctx.companyId && src.companyExpr) {
    params.push(ctx.companyId);
    where.push(`${src.companyExpr} = $${params.length}`);
  }
  if (def.require_wa_consent && src.fields.wa_consent) {
    where.push(src.fields.wa_consent.sql);
  }
  for (const f of def.filters) {
    const sql = filterSql(def.source, f, params);
    if (sql) where.push(sql);
  }
  if (src.phoneExpr) {
    // Penerima tanpa nomor tidak berguna untuk kampanye WA.
    where.push(`${src.phoneExpr} IS NOT NULL AND ${src.phoneExpr} <> ''`);
  }

  const useRfm = def.rfm.enabled && src.supportsRfm;
  const baseSelect = `SELECT ${src.idExpr} AS id, ${src.nameExpr} AS name, ${src.phoneExpr} AS phone`;

  if (!useRfm) {
    const inner = `${baseSelect}
      FROM ${src.from}
      WHERE ${where.join(" AND ")}`;
    const sql = ctx.countOnly
      ? `SELECT COUNT(*)::int AS total FROM (${inner} LIMIT ${def.limit}) q`
      : `${inner} ORDER BY name LIMIT ${def.limit}`;
    return { sql, params, withRfm: false };
  }

  // NTILE(5): urut menaik supaya 5 = terbaik di semua dimensi.
  const f = src.fields;
  const inner = `
    WITH base AS (
      ${baseSelect},
             ${f.last_visit.sql} AS last_visit,
             ${f.visit_count.sql} AS visit_count,
             ${f.total_spent.sql} AS total_spent
      FROM ${src.from}
      WHERE ${where.join(" AND ")}
    ), scored AS (
      SELECT b.*,
             NTILE(5) OVER (ORDER BY b.last_visit ASC NULLS FIRST) AS r_score,
             NTILE(5) OVER (ORDER BY b.visit_count ASC) AS f_score,
             NTILE(5) OVER (ORDER BY b.total_spent ASC) AS m_score
      FROM base b
    )
    SELECT id, name, phone, last_visit, visit_count, total_spent, r_score, f_score, m_score
    FROM scored
    WHERE r_score BETWEEN ${clamp(def.rfm.recency.min)} AND ${clamp(def.rfm.recency.max)}
      AND f_score BETWEEN ${clamp(def.rfm.frequency.min)} AND ${clamp(def.rfm.frequency.max)}
      AND m_score BETWEEN ${clamp(def.rfm.monetary.min)} AND ${clamp(def.rfm.monetary.max)}`;

  const sql = ctx.countOnly
    ? `SELECT COUNT(*)::int AS total FROM (${inner} LIMIT ${def.limit}) q`
    : `${inner} ORDER BY m_score DESC, f_score DESC, r_score DESC, name LIMIT ${def.limit}`;
  return { sql, params, withRfm: true };
}

/** Skor 1–5; nilai di luar rentang dijepit agar tidak pernah masuk SQL apa adanya. */
function clamp(n: number): number {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i)) return 1;
  return Math.min(5, Math.max(1, i));
}

/**
 * Fragment WHERE untuk dipasang di query lain (mis. pembangun penerima
 * kampanye yang memakai alias `c` dan sudah memesan $1..$n).
 *
 * RFM butuh window function yang tidak bisa berada di WHERE, jadi saat RFM
 * aktif fragmennya berbentuk `alias.id IN (subquery berskor)`.
 */
export function buildSegmentWhere(
  def: SegmentDefinition,
  { alias, startIndex, companyId }: { alias: string; startIndex: number; companyId: string | null }
): { where: string; params: unknown[] } {
  const built = buildSegmentQuery(def, { companyId });
  // Geser nomor parameter agar tidak bentrok dengan $1..$(startIndex-1) milik pemanggil.
  const shifted = built.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + startIndex - 1}`);
  const src = segmentSourceDef(def.source);
  if (!built.withRfm) {
    // Tanpa RFM cukup salin kondisinya, tapi ekspresi memakai alias `t`.
    const inner = shifted.slice(shifted.indexOf(" WHERE ") + 7).replace(/\s+ORDER BY[\s\S]*$/, "").replace(/\s+LIMIT \d+\s*$/, "");
    return { where: `(${retarget(inner, src, alias)})`, params: built.params };
  }
  const subquery = shifted.replace(/\s+ORDER BY[\s\S]*$/, "");
  return { where: `${alias}.id IN (SELECT id FROM (${subquery}) seg)`, params: built.params };
}

/** Ganti alias tabel utama `t.` menjadi alias pemanggil. */
function retarget(sql: string, src: SegmentSourceDef, alias: string): string {
  if (alias === "t") return sql;
  // Hanya alias tabel utama yang diganti; join (ac.) dibiarkan apa adanya,
  // karena fragmen tanpa RFM hanya dipakai untuk sumber tanpa join.
  void src;
  return sql.replace(/\bt\./g, `${alias}.`);
}

/** Ringkasan definisi untuk ditampilkan di daftar segmen. */
export function describeSegment(def: SegmentDefinition): string {
  const parts: string[] = [SEGMENT_SOURCE_LABELS[def.source]];
  if (def.filters.length > 0) parts.push(`${def.filters.length} filter`);
  if (def.rfm.enabled) {
    const r = (x: { min: number; max: number }) => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`);
    parts.push(`RFM R${r(def.rfm.recency)} F${r(def.rfm.frequency)} M${r(def.rfm.monetary)}`);
  }
  if (def.require_wa_consent) parts.push("hanya izin WA");
  return parts.join(" · ");
}

/** Cocokkan definisi RFM dengan preset bernama, bila persis sama. */
export function matchRfmPreset(rfm: RfmFilter): string | null {
  if (!rfm.enabled) return null;
  for (const [key, preset] of Object.entries(RFM_PRESETS)) {
    const p = preset.rfm;
    if (
      p.recency.min === rfm.recency.min && p.recency.max === rfm.recency.max &&
      p.frequency.min === rfm.frequency.min && p.frequency.max === rfm.frequency.max &&
      p.monetary.min === rfm.monetary.min && p.monetary.max === rfm.monetary.max
    ) return key;
  }
  return null;
}
