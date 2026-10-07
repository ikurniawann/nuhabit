import { z } from "zod";
import type { CandidateStatus } from "@/types";
import { CANDIDATE_STATUS_LABELS } from "./status";

/** Sumber lamaran yang bisa dipilih HR; kunci = nilai kolom candidates.source. */
export const CANDIDATE_SOURCE_LABELS = {
  portal: "Portal",
  internal: "Internal",
  referral: "Rekomendasi",
  jobstreet: "JobStreet",
  instagram: "Instagram",
  jobfair: "Job Fair",
  walk_in: "Walk-in",
  internal_referral: "Referral Internal",
  headhunter: "Headhunter",
  other: "Lainnya",
} as const;

export type CandidateSource = keyof typeof CANDIDATE_SOURCE_LABELS;

export const CANDIDATE_AVAILABILITIES = ["immediate", "1_week", "2_weeks", "1_month"] as const;

const STATUSES = Object.keys(CANDIDATE_STATUS_LABELS) as [CandidateStatus, ...CandidateStatus[]];
const SOURCES = Object.keys(CANDIDATE_SOURCE_LABELS) as [CandidateSource, ...CandidateSource[]];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id: string) => UUID_RE.test(id);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");

/**
 * Query string GET /api/candidates. `all=true` mematikan paging (papan
 * pipeline, talent pool, ekspor CSV); default tetap 20 per halaman.
 */
export const candidateListQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  brand_id: z.string().uuid().optional(),
  position_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  sort: z.enum(["created_at", "updated_at"]).default("created_at"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  all: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

/** Ambil parameter yang terisi saja (string kosong dianggap tidak ada). */
export function parseCandidateListQuery(searchParams: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams) if (value !== "") raw[key] = value;
  return candidateListQuerySchema.safeParse(raw);
}

/** Escape wildcard LIKE supaya input pencarian dicari apa adanya. */
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, "\\$&")}%`;

/** WHERE parametris untuk daftar kandidat (alias tabel `c`). */
export function buildCandidateListWhere(q: Omit<CandidateListQuery, "sort" | "page" | "limit" | "all">) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(`$${params.length}`));
  };

  if (q.status) add((n) => `c.status = ${n}`, q.status);
  if (q.brand_id) add((n) => `c.brand_id = ${n}`, q.brand_id);
  if (q.position_id) add((n) => `c.position_id = ${n}`, q.position_id);
  // timezone sesi = Asia/Jakarta, jadi batas tanggal mengikuti hari WIB
  if (q.date_from) add((n) => `c.created_at >= ${n}::date`, q.date_from);
  if (q.date_to) add((n) => `c.created_at < ${n}::date + 1`, q.date_to);
  if (q.search) {
    add((n) => `(c.full_name ILIKE ${n} OR c.email ILIKE ${n} OR c.phone ILIKE ${n})`, likePattern(q.search));
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const optionalUuid = z
  .union([z.string().uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

const candidateFields = {
  full_name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  email: z.string().trim().email("Email tidak valid"),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{8,20}$/, "Nomor telepon tidak valid"),
  domicile: z.string().trim().min(1, "Domisili wajib diisi").max(100, "Domisili maksimal 100 karakter"),
  source: z.enum(SOURCES),
  brand_id: optionalUuid,
  position_id: optionalUuid,
  status: z.enum(["applied", "screening"]),
  notes: optionalText(1000),
  last_experience: optionalText(300),
  last_education: optionalText(300),
  availability: z.enum(CANDIDATE_AVAILABILITIES).nullish().transform((v) => v ?? null),
  expected_salary: z.number().int().min(0).max(2_000_000_000).nullish().transform((v) => v ?? null),
  cv_url: z.string().url("URL CV tidak valid").nullish().transform((v) => v ?? null),
  photo_url: z.string().url("URL foto tidak valid").nullish().transform((v) => v ?? null),
};

/** Body POST /api/candidates (form tambah kandidat HR dan klien Open API). */
export const candidateCreateSchema = z.object({
  ...candidateFields,
  source: candidateFields.source.default("walk_in"),
  status: candidateFields.status.default("applied"),
});

/** Body PUT /api/candidates/[id]: field profil yang dikirim saja. Status wajib lewat /stage. */
export const candidateUpdateSchema = z.object(candidateFields).omit({ status: true }).partial();

export type CandidateCreateInput = z.input<typeof candidateCreateSchema>;
export type CandidateCreateData = z.output<typeof candidateCreateSchema>;

/** Nomor halaman yang ditampilkan: maksimal `size` angka, halaman aktif di tengah bila bisa. */
export function pageWindow(page: number, totalPages: number, size = 5): number[] {
  const count = Math.min(size, totalPages);
  const start = Math.min(Math.max(1, page - Math.floor(size / 2)), totalPages - count + 1);
  return Array.from({ length: count }, (_, i) => start + i);
}
