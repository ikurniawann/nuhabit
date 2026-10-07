import type { ClearanceKey } from "@/lib/hris/offboarding-view";

export interface OffboardingEmployee {
  id: string;
  full_name: string;
  nip: string;
  email: string;
  department?: { name: string };
  job_title?: { title: string };
  employment_status: string;
  is_active: boolean;
}

export interface OffboardingRecord {
  id: string;
  employee_id: string;
  resignation_type: string;
  resignation_date: string;
  last_working_day: string;
  reason: string | null;
  status: string;
  exit_interview_date: string | null;
  exit_interview_notes: string | null;
  final_payroll_date: string | null;
  final_payroll_amount: number | null;
  asset_return_status: Record<string, boolean>;
  clearance_hrd: boolean;
  clearance_it: boolean;
  clearance_finance: boolean;
  clearance_manager: boolean;
  created_at: string;
}

export interface InitiateOffboardingPayload {
  resignation_type: string;
  resignation_date: string;
  last_working_day: string;
  reason: string | null;
}

export interface UpdateOffboardingPayload {
  clearance_type?: ClearanceKey;
  cleared?: boolean;
  notes?: string;
  asset_updates?: Record<string, boolean>;
  status?: string;
}
