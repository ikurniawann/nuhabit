import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";

/**
 * GET /api/candidates/[id]/psikotes: data panel Psikotes HRD:
 * rekomendasi keseluruhan + semua sesi tes kandidat (dgn hasil per
 * instrumen & rekap proctoring). Token sesi ikut dikirim (HR yang membuat
 * undangan; dipakai utk salin link / template WA).
 */

/**
 * Token sesi = kredensial pengerjaan tes (dipakai portal publik tanpa login).
 * Hanya role yang memang membagikan link ke kandidat yang menerimanya;
 * hiring_manager (read-only) melihat panel tanpa token.
 */
const TOKEN_ROLES = new Set(["super_admin", "admin", "hrd"]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");

  const [summary, sessions, tests, proctor] = await Promise.all([
    queryOne(
      `SELECT id, candidate_id, recommendation, notes, updated_by, updated_by_name,
              created_at, updated_at
       FROM recruitment.candidate_psikotes_summary WHERE candidate_id = $1`,
      [id]
    ),
    query(
      `SELECT id, token, status, webcam_consent, invited_at, expires_at,
              started_at, completed_at, created_by_name, created_at
       FROM recruitment.psikotes_sessions
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [id]
    ),
    query(
      `SELECT t.id, t.session_id, t.status, t.score, t.score_detail,
              t.attachment_path, t.review_notes, t.reviewed_by_name,
              t.ai_insight, t.sort_order, t.started_at, t.completed_at,
              i.code AS instrument_code, i.name AS instrument_name,
              i.kind AS instrument_kind
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at DESC, t.sort_order`,
      [id]
    ),
    query<{ session_id: string; event_type: string; n: number }>(
      `SELECT e.session_id, e.event_type, count(*)::int AS n
       FROM recruitment.psikotes_proctor_events e
       JOIN recruitment.psikotes_sessions s ON s.id = e.session_id
       WHERE s.candidate_id = $1
       GROUP BY e.session_id, e.event_type`,
      [id]
    ),
  ]);

  const proctorBySession = new Map<string, { flags: number; snapshots: number }>();
  for (const row of proctor) {
    const entry = proctorBySession.get(row.session_id) ?? { flags: 0, snapshots: 0 };
    if (row.event_type === "webcam_snapshot") entry.snapshots += row.n;
    else entry.flags += row.n;
    proctorBySession.set(row.session_id, entry);
  }

  const testsBySession = new Map<string, unknown[]>();
  for (const test of tests) {
    const list = testsBySession.get(test.session_id as string) ?? [];
    list.push(test);
    testsBySession.set(test.session_id as string, list);
  }

  return NextResponse.json({
    data: {
      summary: summary ?? null,
      sessions: sessions.map((s) => ({
        ...s,
        token: TOKEN_ROLES.has(user.role) ? s.token : null,
        proctor: proctorBySession.get(s.id as string) ?? { flags: 0, snapshots: 0 },
        tests: testsBySession.get(s.id as string) ?? [],
      })),
    },
  });
}, "candidate-psikotes");
