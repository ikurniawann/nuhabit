import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { query, withTransaction } from "@/lib/db";
import { z } from "zod";
import { logCandidateActivity, parseBody, requireCandidate } from "@/lib/recruitment/candidates-repo";

/**
 * Catatan internal HR per kandidat (timeline, append-only).
 * GET  /api/candidates/[id]/notes: daftar catatan terbaru dulu.
 * POST /api/candidates/[id]/notes: tambah catatan; penulis direkam dari session.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const noteSchema = z.object({
  content: z
    .string("Catatan tidak boleh kosong")
    .trim()
    .min(1, "Catatan tidak boleh kosong")
    .max(2000, "Catatan maksimal 2000 karakter"),
});

const NOTE_FIELDS = "id, candidate_id, content, created_by, created_by_name, created_at";

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  await requireCandidate(id);
  const rows = await query(
    `SELECT ${NOTE_FIELDS} FROM recruitment.candidate_notes WHERE candidate_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return NextResponse.json({ data: rows });
}, "candidate-notes");

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  const { content } = await parseBody(req, noteSchema);
  await requireCandidate(id);

  const note = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO recruitment.candidate_notes (candidate_id, content, created_by, created_by_name)
       VALUES ($1, $2, $3, $4) RETURNING ${NOTE_FIELDS}`,
      [id, content, user.id, user.full_name]
    );
    await logCandidateActivity(id, "note_added", "Catatan internal ditambahkan", user, client);
    return res.rows[0];
  });

  return NextResponse.json({ data: note, message: "Catatan tersimpan" }, { status: 201 });
}, "candidate-notes");
