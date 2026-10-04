export interface PositionItem {
  id: string;
  title: string;
  department: string;
  level: string;
  is_active: boolean;
  created_at: string;
}

export interface PositionPayload {
  title: string;
  department?: string;
  level?: string;
  is_active?: boolean;
}
