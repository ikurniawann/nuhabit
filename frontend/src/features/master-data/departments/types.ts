export interface DepartmentItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface DepartmentPayload {
  name: string;
  code: string;
  description?: string;
  is_active?: boolean;
}
