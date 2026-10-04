// ============================================================
// API Route: Announcement by ID
// GET   : detail — pengelola (semua) / karyawan (bila menyasar & published)
// PATCH : update (pengelola)
// DELETE: hapus (pengelola)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne, withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import {
  ANNOUNCEMENT_MANAGE_ROLES,
  canManageAnnouncements,
} from "@/lib/hris/announcements";
import { parseVideoUrl } from "@/lib/hris/announcement-video";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200),
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

// ============================================================
// GET /api/hris/announcements/[id]
// ============================================================

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    const announcement = await queryOne<Record<string, unknown>>(
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

    if (!announcement) {
      return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });
    }

    // Karyawan biasa: hanya boleh detail bila published, dalam jendela tayang,
    // dan menyasar dirinya (global atau departemennya).
    if (!canManageAnnouncements(actor.role)) {
      const visible = await isVisibleToEmployee(id, actor.employeeId);
      if (!visible) {
        return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });
      }
    }

    return NextResponse.json({ data: announcement });
  } catch (error) {
    console.error("Error fetching announcement:", error);
    return NextResponse.json({ error: "Gagal mengambil pengumuman" }, { status: 500 });
  }
}

async function isVisibleToEmployee(
  announcementId: string,
  employeeId: string | null
): Promise<boolean> {
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

// ============================================================
// PATCH /api/hris/announcements/[id]
// ============================================================

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM hris.announcements WHERE id = $1`,
      [id]
    );
    if (!existing) {
      return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });
    }

    const body = updateSchema.parse(await req.json());

    if (body.target_scope === "department" && body.department_ids.length === 0) {
      return NextResponse.json(
        { error: "Pilih minimal satu departemen atau ubah target ke global" },
        { status: 400 }
      );
    }

    let videoProvider: string | null = null;
    let videoId: string | null = null;
    if (body.video_url) {
      const parsed = parseVideoUrl(body.video_url);
      if (!parsed) {
        return NextResponse.json(
          { error: "URL video harus YouTube atau Vimeo yang valid" },
          { status: 400 }
        );
      }
      videoProvider = parsed.provider;
      videoId = parsed.id;
    }

    const updated = await withTransaction(async (client) => {
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
          videoProvider,
          videoId,
          body.tags,
          body.status,
          body.is_pinned,
          body.target_scope,
          body.publish_at ?? null,
          body.expires_at ?? null,
        ]
      );

      // Ganti set departemen target
      await client.query(
        `DELETE FROM hris.announcement_departments WHERE announcement_id = $1`,
        [id]
      );
      if (body.target_scope === "department" && body.department_ids.length > 0) {
        await client.query(
          `INSERT INTO hris.announcement_departments (announcement_id, department_id)
           SELECT $1, unnest($2::uuid[])`,
          [id, body.department_ids]
        );
      }
      return rows[0];
    });

    return NextResponse.json({ data: updated, message: "Pengumuman diperbarui" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validasi gagal", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error updating announcement:", error);
    return NextResponse.json({ error: "Gagal memperbarui pengumuman" }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/hris/announcements/[id]
// ============================================================

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    // FK ON DELETE CASCADE membersihkan departments & reads.
    await query(`DELETE FROM hris.announcements WHERE id = $1`, [id]);
    return NextResponse.json({ message: "Pengumuman dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting announcement:", error);
    return NextResponse.json({ error: "Gagal menghapus pengumuman" }, { status: 500 });
  }
}
