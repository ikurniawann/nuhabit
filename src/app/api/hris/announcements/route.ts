// ============================================================
// API Route: Announcements (CMS)
// GET : daftar utk pengelola (HRD/super_admin) — semua status
// POST: buat pengumuman baru
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { ANNOUNCEMENT_MANAGE_ROLES } from "@/lib/hris/announcements";
import { parseVideoUrl } from "@/lib/hris/announcement-video";

const upsertSchema = z.object({
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

export type AnnouncementUpsert = z.infer<typeof upsertSchema>;

/** Validasi bersama create/update; return {video, error}. */
export function resolveVideo(videoUrl: string | null | undefined) {
  if (!videoUrl) return { provider: null, id: null, error: null as string | null };
  const parsed = parseVideoUrl(videoUrl);
  if (!parsed) {
    return { provider: null, id: null, error: "URL video harus YouTube atau Vimeo yang valid" };
  }
  return { provider: parsed.provider, id: parsed.id, error: null };
}

// ============================================================
// GET /api/hris/announcements  (CMS)
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const rows = await query(
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

    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error listing announcements:", error);
    return NextResponse.json({ error: "Gagal mengambil pengumuman" }, { status: 500 });
  }
}

// ============================================================
// POST /api/hris/announcements
// ============================================================

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const actor = await getWorkforceActor();
    const body = upsertSchema.parse(await request.json());

    if (body.target_scope === "department" && body.department_ids.length === 0) {
      return NextResponse.json(
        { error: "Pilih minimal satu departemen atau ubah target ke global" },
        { status: 400 }
      );
    }

    const video = resolveVideo(body.video_url);
    if (video.error) {
      return NextResponse.json({ error: video.error }, { status: 400 });
    }

    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
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
          actor?.employeeId ?? null,
        ]
      );
      const announcement = rows[0];

      if (body.target_scope === "department" && body.department_ids.length > 0) {
        await client.query(
          `INSERT INTO hris.announcement_departments (announcement_id, department_id)
           SELECT $1, unnest($2::uuid[])`,
          [announcement.id, body.department_ids]
        );
      }
      return announcement;
    });

    return NextResponse.json({
      data: created,
      message: "Pengumuman berhasil dibuat",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validasi gagal", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error creating announcement:", error);
    return NextResponse.json({ error: "Gagal membuat pengumuman" }, { status: 500 });
  }
}
