export interface EmploymentStatusItem {
  id: string;
  code: string;
  name: string;
  color: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface EmploymentStatusPayload {
  code: string;
  name: string;
  color?: string;
  description?: string;
  is_active?: boolean;
}
