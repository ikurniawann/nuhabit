import { query, queryOne } from "@/lib/db";
import type { InterviewAiSummary } from "./interview-ai";
import type { DrawingAiInsight } from "./psikotes-ai";

/**
 * Agregasi data perjalanan pipeline kandidat untuk laporan PDF —
 * satu objek berisi seluruh tahapan: applied (analisis AI CV), screening,
 * psikotes, interview AI, offer, plus timeline aktivitas.
 */

export interface ReportCandidate {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  domicile: string | null;
  source: string | null;
  status: string;
  last_experience: string | null;
  last_education: string | null;
  expected_salary: string | null;
  created_at: string;
  position_title: string | null;
}

export interface ReportAiAnalysis {
  match_score: number | null;
  match_reason: string | null;
  summary: string | null;
  model: string | null;
  updated_at: string;
}

export interface ReportScreening {
  contacted: boolean;
  interested: boolean | null;
  availability_note: string | null;
  confirmed_salary: string | null;
  willing_shift: boolean | null;
  willing_placement: boolean | null;
  notes: string | null;
  recommendation: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

/** Isi kolom jsonb psikotes_session_tests.ai_insight (tes drawing). */
export interface ReportPsikotesAiInsight {
  observation: string;
  /** Undefined utk record lama (sebelum mode otomatis ada) = manual. */
  observation_source?: "manual" | "ai";
  vision_model?: string | null;
  insight: DrawingAiInsight;
  model: string;
  created_at: string;
  created_by_name?: string | null;
}

export interface ReportPsikotesTest {
  session_id: string;
  session_status: string;
  session_completed_at: string | null;
  instrument_name: string;
  status: string;
  score: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  ai_insight: ReportPsikotesAiInsight | null;
}

export interface ReportPsikotesSummary {
  recommendation: string | null;
  notes: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

export interface ReportInterviewSession {
  status: string;
  invited_at: string | null;
  completed_at: string | null;
  ai_summary: InterviewAiSummary | null;
  summary_model: string | null;
  turn_count: string;
}

export interface ReportOffer {
  version: number;
  status: string;
  position_title: string | null;
  base_salary: string;
  start_date: string | null;
  sent_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  created_by_name: string | null;
}

/** Data karyawan hasil promosi kandidat yang sudah hired. */
export interface ReportHired {
  promotion_date: string | null;
  nip: string | null;
  join_date: string | null;
  employment_status: string | null;
  is_active: boolean;
  has_account: boolean;
  department_name: string | null;
  job_title: string | null;
  reporting_to_name: string | null;
  onboarding_total: number;
  onboarding_completed: number;
}

export interface ReportActivity {
  activity_type: string;
  description: string;
  created_by_name: string | null;
  created_at: string;
}

export interface PipelineReportData {
  candidate: ReportCandidate;
  aiAnalysis: ReportAiAnalysis | null;
  screening: ReportScreening | null;
  psikotesTests: ReportPsikotesTest[];
  psikotesSummary: ReportPsikotesSummary | null;
  interviews: ReportInterviewSession[];
  offers: ReportOffer[];
  hired: ReportHired | null;
  activities: ReportActivity[];
}

export async function getPipelineReportData(
  candidateId: string
): Promise<PipelineReportData | null> {
  const candidate = await queryOne<ReportCandidate>(
    `SELECT c.id, c.full_name, c.email, c.phone, c.domicile, c.source, c.status,
            c.last_experience, c.last_education, c.expected_salary, c.created_at,
            p.title AS position_title
     FROM recruitment.candidates c
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE c.id = $1`,
    [candidateId]
  );
  if (!candidate) return null;

  const [
    aiAnalysis,
    screening,
    psikotesTests,
    psikotesSummary,
    interviews,
    offers,
    hired,
    activities,
  ] = await Promise.all([
    queryOne<ReportAiAnalysis>(
      `SELECT match_score, match_reason, summary, model, updated_at
       FROM recruitment.candidate_ai_analysis
       WHERE candidate_id = $1`,
      [candidateId]
    ),
    queryOne<ReportScreening>(
      `SELECT contacted, interested, availability_note, confirmed_salary,
              willing_shift, willing_placement, notes, recommendation,
              updated_by_name, updated_at
       FROM recruitment.candidate_screenings
       WHERE candidate_id = $1`,
      [candidateId]
    ),
    query<ReportPsikotesTest>(
      `SELECT s.id AS session_id, s.status AS session_status,
              s.completed_at AS session_completed_at,
              i.name AS instrument_name, t.status, t.score,
              t.review_notes, t.reviewed_by_name, t.ai_insight
       FROM recruitment.psikotes_sessions s
       JOIN recruitment.psikotes_session_tests t ON t.session_id = s.id
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at ASC, t.sort_order ASC`,
      [candidateId]
    ),
    queryOne<ReportPsikotesSummary>(
      `SELECT recommendation, notes, updated_by_name, updated_at
       FROM recruitment.candidate_psikotes_summary
       WHERE candidate_id = $1`,
      [candidateId]
    ),
    query<ReportInterviewSession>(
      `SELECT s.status, s.invited_at, s.completed_at, s.ai_summary, s.summary_model,
              (SELECT count(*) FROM recruitment.interview_ai_turns t
               WHERE t.session_id = s.id AND t.answered_at IS NOT NULL) AS turn_count
       FROM recruitment.interview_ai_sessions s
       WHERE s.candidate_id = $1
       ORDER BY s.created_at ASC`,
      [candidateId]
    ),
    query<ReportOffer>(
      `SELECT version, status, position_title, base_salary, start_date,
              sent_at, expires_at, responded_at, response_note, created_by_name
       FROM recruitment.candidate_offers
       WHERE candidate_id = $1
       ORDER BY version ASC`,
      [candidateId]
    ),
    queryOne<ReportHired>(
      `SELECT c.promotion_date, e.nip, e.join_date, e.employment_status,
              e.is_active, (e.user_id IS NOT NULL) AS has_account,
              d.name AS department_name, p.title AS job_title,
              m.full_name AS reporting_to_name,
              coalesce(ob.total, 0) AS onboarding_total,
              coalesce(ob.completed, 0) AS onboarding_completed
       FROM recruitment.candidates c
       JOIN hris.employees e ON e.id = c.promoted_to_employee_id
       LEFT JOIN hris.departments d ON d.id = e.department_id
       LEFT JOIN hris.positions p ON p.id = e.job_title_id
       LEFT JOIN hris.employees m ON m.id = e.reporting_to
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE completed)::int AS completed
         FROM hris.onboarding_checklists oc
         WHERE oc.employee_id = e.id
       ) ob ON true
       WHERE c.id = $1`,
      [candidateId]
    ),
    query<ReportActivity>(
      `SELECT activity_type, description, created_by_name, created_at
       FROM recruitment.candidate_activities
       WHERE candidate_id = $1
       ORDER BY created_at ASC`,
      [candidateId]
    ),
  ]);

  return {
    candidate,
    aiAnalysis,
    screening,
    psikotesTests,
    psikotesSummary,
    interviews,
    offers,
    hired,
    activities,
  };
}
