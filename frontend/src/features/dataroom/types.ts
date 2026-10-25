export interface DepartmentRef { id: string; name: string }

export type AccessLevel = "viewer" | "commenter" | "editor" | "owner";

export interface DataroomItem {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size_bytes: number;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string;
  updated_at: string;
  description?: string | null;
  tags?: string[];
  trashed_at?: string | null;
  trashed_root?: boolean;
  version?: number;
  locked_by?: string | null;
  locked_by_name?: string | null;
  locked_at?: string | null;
  restricted?: boolean;
  /** Folder: departemen yang boleh membuka (kosong = semua). */
  departments?: DepartmentRef[];
  starred?: boolean;
  /** Hak akses pengguna saat ini pada item ini. */
  my_level?: AccessLevel | "";
  /** Jejak folder (pencarian dan tampilan khusus). */
  path?: { id: string; name: string; parent_id: string | null }[];
}

export type DriveView = "" | "starred" | "recent" | "shared" | "trash";

export interface DataroomListing {
  parent: DataroomItem | null;
  items: DataroomItem[];
  ancestors: { id: string; name: string; parent_id: string | null }[];
  usage: { used: number; quota: number; max_file: number; max_chunked?: number };
  permissions: { create: boolean; update: boolean; delete: boolean; manage_access?: boolean; level?: AccessLevel | "" };
  actor?: { user_id?: string; is_admin: boolean; department_name: string | null };
  view?: DriveView;
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
  allow_download?: boolean;
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

export interface VersionRow {
  id: string;
  node_id: string;
  version: number;
  name: string;
  mime: string | null;
  size_bytes: number;
  created_by_name: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  node_id: string;
  parent_id: string | null;
  body: string;
  mentions: string[];
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  deleted: boolean;
}

export interface ActivityRow {
  id: string;
  node_id: string | null;
  parent_id: string | null;
  action: string;
  node_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface GrantRow {
  id: string;
  node_id: string;
  subject_type: "user" | "role";
  subject_id: string;
  subject_name: string;
  role: AccessLevel;
  created_at: string;
}

export interface Person {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
}

export interface UploadSession {
  id: string;
  parent_id: string | null;
  replace_node_id: string | null;
  name: string;
  size_bytes: number;
  received_bytes: number;
  expires_at: string;
  chunk_bytes?: number;
}
