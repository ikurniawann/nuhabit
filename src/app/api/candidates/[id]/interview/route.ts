import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query } from "@/lib/db";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";

/**
 * GET /api/candidates/[id]/interview: data panel Interview AI utk HRD:
 * semua sesi interview kandidat (dgn transkrip turn, kesimpulan AI &
 * rekap proctoring). Token sesi hanya utk role yang membagikan link.
 */

const TOKEN_ROLES = new Set(["super_admin", "admin", "hrd"]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");

  const [sessions, turns, proctor] = await Promise.all([
    query(
      `SELECT id, token, status, webcam_consent, config, ai_summary, summary_model,
              summarized_at, invited_at, expires_at, started_at, completed_at,
              created_by_name, created_at
       FROM recruitment.interview_ai_sessions
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [id]
    ),
    query(
      `SELECT t.id, t.session_id, t.turn_no, t.topic, t.question,
              t.answer_transcript, t.answer_mode, t.answer_audio_path,
              t.asked_at, t.answered_at
       FROM recruitment.interview_ai_turns t
       JOIN recruitment.interview_ai_sessions s ON s.id = t.session_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at DESC, t.turn_no`,
      [id]
    ),
    query<{ session_id: string; event_type: string; n: number }>(
      `SELECT e.session_id, e.event_type, count(*)::int AS n
       FROM recruitment.interview_ai_proctor_events e
       JOIN recruitment.interview_ai_sessions s ON s.id = e.session_id
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

  const turnsBySession = new Map<string, unknown[]>();
  for (const turn of turns) {
    const list = turnsBySession.get(turn.session_id as string) ?? [];
    list.push(turn);
    turnsBySession.set(turn.session_id as string, list);
  }

  return NextResponse.json({
    data: {
      sessions: sessions.map((s) => ({
        ...s,
        token: TOKEN_ROLES.has(user.role) ? s.token : null,
        proctor: proctorBySession.get(s.id as string) ?? { flags: 0, snapshots: 0 },
        turns: turnsBySession.get(s.id as string) ?? [],
      })),
    },
  });
}, "candidate-interview");
