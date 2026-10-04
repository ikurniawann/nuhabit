import { z } from "zod";
import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { savePrivateImage } from "@/lib/storage-private";
import { parseVideoUrl } from "./announcement-video";

/**
 * Pengumuman perusahaan (hris.announcements): CMS pengelola, feed karyawan,
 * penanda baca, dan cover. Visibilitas karyawan: published, dalam jendela
 * tayang, dan menyasar global atau departemennya.
 */

export const announcementUpsertSchema = z.object({
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  body_html: z.string().max(100_000).default(""),
  cover_image_url: z.string().nullable().optional(),
  video_url: z.string().trim().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(["draft", "published"]).default("draft"),
  is_pinned: z.boolean().default(false),
  target_scope: z.enum(["global", "department"]).default("global"),
  department_ids: z.array(z.string().uuid()).default([]),
  publish_at: z.string().datetime({ offset: true }).nullable().optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export type AnnouncementUpsert = z.infer<typeof announcementUpsertSchema>;

/** Video opsional: YouTube/Vimeo → provider + id; selain itu 400. */
export function resolveVideo(videoUrl: string | null | undefined) {
  if (!videoUrl) return { provider: null, id: null };
  const parsed = parseVideoUrl(videoUrl);
  if (!parsed) throw ApiError.badRequest("URL video harus YouTube atau Vimeo yang valid");
  return { provider: parsed.provider, id: parsed.id };
}

function assertTarget(body: AnnouncementUpsert) {
  if (body.target_scope === "department" && body.department_ids.length === 0) {
    throw ApiError.badRequest("Pilih minimal satu departemen atau ubah target ke global");
  }
}

async function replaceTargetDepartments(client: PoolClient, id: string, body: AnnouncementUpsert) {
  if (body.target_scope === "department" && body.department_ids.length > 0) {
    await client.query(
      `INSERT INTO hris.announcement_departments (announcement_id, department_id)
       SELECT $1, unnest($2::uuid[])`,
      [id, body.department_ids]
    );
  }
}

export async function listAnnouncements(status: string | null) {
  return query(
    `SELECT a.*,
            creator.full_name AS created_by_name,
            COALESCE(
              (SELECT array_agg(ad.department_id) FROM hris.announcement_departments ad
               WHERE ad.announcement_id = a.id), '{}'
            ) AS department_ids,
            (SELECT count(*) FROM hris.announcement_reads r WHERE r.announcement_id = a.id) AS read_count
     FROM hris.announcements a
     LEFT JOIN hris.employees creator ON creator.id = a.created_by
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC`,
    [status]
  );
}

export async function createAnnouncement(body: AnnouncementUpsert, createdBy: string | null) {
  assertTarget(body);
  const video = resolveVideo(body.video_url);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hris.announcements
         (title, body_html, cover_image_url, video_provider, video_id, tags,
          status, is_pinned, target_scope, publish_at, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        body.title,
        body.body_html,
        body.cover_image_url ?? null,
        video.provider,
        video.id,
        body.tags,
        body.status,
        body.is_pinned,
        body.target_scope,
        body.publish_at ?? null,
        body.expires_at ?? null,
        createdBy,
      ]
    );
    await replaceTargetDepartments(client, rows[0].id, body);
    return rows[0];
  });
}

export async function updateAnnouncement(id: string, body: AnnouncementUpsert) {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM hris.announcements WHERE id = $1`,
    [id]
  );
  if (!existing) throw ApiError.notFound("Pengumuman tidak ditemukan");
  assertTarget(body);
  const video = resolveVideo(body.video_url);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE hris.announcements SET
         title = $2, body_html = $3, cover_image_url = $4,
         video_provider = $5, video_id = $6, tags = $7, status = $8,
         is_pinned = $9, target_scope = $10, publish_at = $11,
         expires_at = $12, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.title,
        body.body_html,
        body.cover_image_url ?? null,
        video.provider,
        video.id,
        body.tags,
        body.status,
        body.is_pinned,
        body.target_scope,
        body.publish_at ?? null,
        body.expires_at ?? null,
      ]
    );
    await client.query(`DELETE FROM hris.announcement_departments WHERE announcement_id = $1`, [id]);
    await replaceTargetDepartments(client, id, body);
    return rows[0];
  });
}

/** FK ON DELETE CASCADE membersihkan departments & reads. */
export async function deleteAnnouncement(id: string) {
  await query(`DELETE FROM hris.announcements WHERE id = $1`, [id]);
}

async function isVisibleToEmployee(announcementId: string, employeeId: string | null) {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok
     FROM hris.announcements a
     WHERE a.id = $1
       AND a.status = 'published'
       AND (a.publish_at IS NULL OR a.publish_at <= now())
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (
         a.target_scope = 'global'
         OR EXISTS (
           SELECT 1 FROM hris.announcement_departments ad
           JOIN hris.employees e ON e.id = $2
           WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
         )
       )
     LIMIT 1`,
    [announcementId, employeeId]
  );
  return Boolean(row?.ok);
}

/** Detail; karyawan biasa hanya bila pengumuman tayang & menyasarnya (selain itu 404). */
export async function getAnnouncement(id: string, viewer: { canManage: boolean; employeeId: string | null }) {
  const announcement = await queryOne(
    `SELECT a.*,
            creator.full_name AS created_by_name,
            COALESCE(
              (SELECT array_agg(ad.department_id) FROM hris.announcement_departments ad
               WHERE ad.announcement_id = a.id), '{}'
            ) AS department_ids
     FROM hris.announcements a
     LEFT JOIN hris.employees creator ON creator.id = a.created_by
     WHERE a.id = $1`,
    [id]
  );
  if (!announcement) throw ApiError.notFound("Pengumuman tidak ditemukan");
  if (!viewer.canManage && !(await isVisibleToEmployee(id, viewer.employeeId))) {
    throw ApiError.notFound("Pengumuman tidak ditemukan");
  }
  return announcement;
}

export interface AnnouncementFeedRow {
  id: string;
  title: string;
  cover_image_url: string | null;
  video_provider: string | null;
  tags: string[];
  is_pinned: boolean;
  publish_at: string | null;
  created_at: string;
  is_read: boolean;
}

/** Feed karyawan: pengumuman tayang yang menyasarnya + penanda sudah dibaca. */
export async function loadAnnouncementFeed(employeeId: string) {
  const rows = await query<AnnouncementFeedRow>(
    `SELECT a.id, a.title, a.cover_image_url, a.video_provider, a.tags,
            a.is_pinned, a.publish_at, a.created_at,
            (r.employee_id IS NOT NULL) AS is_read
     FROM hris.announcements a
     JOIN hris.employees e ON e.id = $1
     LEFT JOIN hris.announcement_reads r
       ON r.announcement_id = a.id AND r.employee_id = $1
     WHERE a.status = 'published'
       AND (a.publish_at IS NULL OR a.publish_at <= now())
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND (
         a.target_scope = 'global'
         OR EXISTS (
           SELECT 1 FROM hris.announcement_departments ad
           WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
         )
       )
     ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
     LIMIT 100`,
    [employeeId]
  );
  return { rows, unread: rows.filter((row) => row.is_read === false).length };
}

/** Tandai dibaca (idempoten), hanya bila pengumuman published & menyasar karyawan. */
export async function markAnnouncementRead(id: string, employeeId: string) {
  await query(
    `INSERT INTO hris.announcement_reads (announcement_id, employee_id)
     SELECT a.id, $2
     FROM hris.announcements a
     JOIN hris.employees e ON e.id = $2
     WHERE a.id = $1
       AND a.status = 'published'
       AND (
         a.target_scope = 'global'
         OR EXISTS (
           SELECT 1 FROM hris.announcement_departments ad
           WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
         )
       )
     ON CONFLICT (announcement_id, employee_id) DO NOTHING`,
    [id, employeeId]
  );
}

const MAX_COVER_BYTES = 5 * 1024 * 1024;

export const coverUploadSchema = z.object({ image: z.string().optional() });

/** Cover data URL (JPG/PNG/WebP ≤ 5 MB) → path storage private. */
export async function saveAnnouncementCover(dataUrl: string | undefined): Promise<string> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) throw ApiError.badRequest("Cover harus berupa gambar JPG/PNG/WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_COVER_BYTES) throw ApiError.badRequest("Ukuran cover maksimal 5 MB");
  const saved = await savePrivateImage(buffer, match[1], "announcements");
  if (!saved.path) throw ApiError.badRequest(saved.error ?? "Gagal menyimpan cover");
  return saved.path;
}
