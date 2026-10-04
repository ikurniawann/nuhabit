export interface DepartmentRef { id: string; name: string }

export interface DataroomItem {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size_bytes: number;
  created_by_name?: string | null;
  created_at?: string;
  updated_at: string;
  /** Folder: departemen yang boleh membuka (kosong = semua). */
  departments?: DepartmentRef[];
}

export interface DataroomListing {
  parent: DataroomItem | null;
  items: DataroomItem[];
  ancestors: { id: string; name: string; parent_id: string | null }[];
  usage: { used: number; quota: number; max_file: number };
  permissions: { create: boolean; update: boolean; delete: boolean; manage_access?: boolean };
  actor?: { is_admin: boolean; department_name: string | null };
}

export interface ShareRow {
  id: string;
  token: string;
  url: string;
  node_id: string;
  node_name: string;
  node_kind: "folder" | "file";
  access_type: "public" | "email";
  allowed_emails: string[];
  has_pin: boolean;
  watermark: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  access_count: number;
  last_accessed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  mail?: { sent: number; failed: string[] } | null;
}

export interface ShareLogRow {
  id: string;
  node_id: string | null;
  action: string;
  file_name: string | null;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}
