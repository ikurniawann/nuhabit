import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { slugify } from "@/lib/recruitment/job-portal-form";
import { unwrap } from "./workforce-route";

/** Lowongan kerja (recruitment.job_openings) untuk modul rekrutmen. */

export const JOB_OPENING_STATUSES = ["draft", "published", "closed"] as const;

/** Body bebas dari form; field non-string diabaikan seperti versi lama. */
export const jobOpeningBodySchema = z.record(z.string(), z.unknown());

type Body = z.infer<typeof jobOpeningBodySchema>;

function text(body: Body, key: string, fallback = ""): string {
  const value = body[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Normalisasi payload lowongan. published_at: saat dibuat, terisi sekarang
 * bila status published; saat diubah, nilai yang dikirim dipertahankan.
 */
export function normalizeJobOpening(body: Body, mode: "create" | "update") {
  const title = text(body, "title").trim();
  const status = text(body, "status", "draft");
  const sentPublishedAt = mode === "update" ? text(body, "published_at") : "";
  const publishedNow = status === "published" ? new Date().toISOString() : null;

  return {
    position_id: text(body, "position_id") || null,
    brand_id: text(body, "brand_id") || null,
    department_id: text(body, "department_id") || null,
    title,
    slug: text(body, "slug", slugify(title)).trim(),
    department: text(body, "department", "Operations").trim(),
    location: text(body, "location", "Jakarta, ID").trim(),
    employment_type: text(body, "employment_type", "Full-time").trim(),
    work_mode: text(body, "work_mode", "On-site").trim(),
    headcount: Number(body.headcount || 1),
    description: text(body, "description").trim() || null,
    requirements: text(body, "requirements").trim() || null,
    benefits: text(body, "benefits").trim() || null,
    status,
    closing_date: text(body, "closing_date") || null,
    published_at: sentPublishedAt || publishedNow,
  };
}

export type JobOpeningPayload = ReturnType<typeof normalizeJobOpening>;

/** Pesan galat validasi (Indonesia) atau null. */
export function validateJobOpening(payload: JobOpeningPayload, mode: "create" | "update"): string | null {
  if (!payload.title) return "Judul lowongan wajib diisi";
  if (mode === "create") {
    if (!payload.slug) return "Slug lowongan wajib diisi";
    if (!(JOB_OPENING_STATUSES as readonly string[]).includes(payload.status)) {
      return "Status lowongan tidak valid";
    }
  }
  return null;
}

const OPENING_SELECT =
  "*, brand:brands(id, name), position:positions(id, title, department, level), department_ref:departments(id, name, code)";

export async function listJobOpenings() {
  const data = unwrap(
    await createPgClient().from("job_openings").select(OPENING_SELECT).order("created_at", { ascending: false })
  );
  return data ?? [];
}

export async function createJobOpening(payload: JobOpeningPayload) {
  return unwrap(await createPgClient().from("job_openings").insert(payload).select(OPENING_SELECT).single());
}

export async function updateJobOpening(id: string, payload: JobOpeningPayload) {
  return unwrap(
    await createPgClient().from("job_openings").update(payload).eq("id", id).select(OPENING_SELECT).single()
  );
}

export async function deleteJobOpening(id: string) {
  const { error } = await createPgClient().from("job_openings").delete().eq("id", id);
  unwrap({ data: null, error });
}
