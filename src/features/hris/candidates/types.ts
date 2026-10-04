import type { Candidate } from "@/types";

export interface CandidateListParams {
  status: string;
  brand_id: string;
  position_id: string;
  search: string;
  date_from: string;
  date_to: string;
  page: number;
  perPage: number;
}

/** Baris GET /api/candidates: kolom kandidat + relasi brand/posisi bersarang. */
export type CandidateRow = Candidate & {
  brands: { name: string } | null;
  positions: { title: string } | null;
};

export interface CandidateListResult {
  data: CandidateRow[];
  count: number;
}

export interface CandidateView {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  domicile: string;
  date_of_birth?: string;
  gender?: string;
  brand_id?: string;
  position_id?: string;
  status: string;
  source: string;
  notes?: string;
  cv_url?: string;
  created_at: string;
  updated_at: string;
  brands?: { name: string } | null;
  positions?: { title: string } | null;
  promoted_to_employee_id?: string | null;
  last_experience?: string | null;
  last_education?: string | null;
  expected_salary?: number | null;
  availability?: string | null;
}

export interface CandidateActivity {
  id: string;
  candidate_id: string;
  activity_type: string;
  description: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface CandidateNote {
  id: string;
  candidate_id: string;
  content: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface CandidateDetailResult {
  candidate: CandidateView | null;
  activities: CandidateActivity[];
  notes: CandidateNote[];
}
