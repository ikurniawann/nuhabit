import type { RfmFilter, SegmentDefinition, SegmentFilter, SegmentSource } from "@/lib/crm/segments";
import type { PublicFieldDef, PublicFormInput } from "@/lib/crm/public-forms";

export type { PublicFieldDef, PublicFormInput, RfmFilter, SegmentDefinition, SegmentFilter, SegmentSource };

export interface SegmentRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  source: SegmentSource;
  definition: SegmentDefinition;
  is_active: boolean;
  last_count: number | null;
  last_counted_at: string | null;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentPreview {
  total: number;
  with_rfm: boolean;
  sample: Array<{
    id: string;
    name: string;
    phone: string | null;
    r_score?: number;
    f_score?: number;
    m_score?: number;
    total_spent?: string | number;
    visit_count?: number;
  }>;
}

export interface FormRow {
  id: string;
  company_id: string | null;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  fields: PublicFieldDef[];
  submit_label: string;
  success_message: string;
  redirect_url: string | null;
  default_source: string;
  notify_user_ids: string[];
  notify_numbers: string[];
  is_active: boolean;
  submission_count: number;
  rejected_count: number | string;
  last_submission_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmissionRow {
  id: string;
  lead_id: string | null;
  status: "ok" | "rejected" | "duplicate";
  reason: string | null;
  utm: Record<string, string | null>;
  created_at: string;
  org_name: string | null;
  pic_name: string | null;
  pic_phone: string | null;
}
