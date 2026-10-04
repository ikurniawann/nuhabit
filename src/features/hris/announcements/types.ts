import type { announcementPayload } from "@/lib/hris/announcements-view";

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface Announcement {
  id: string;
  title: string;
  body_html: string;
  cover_image_url: string | null;
  video_provider: string | null;
  video_id: string | null;
  tags: string[];
  status: string;
  is_pinned: boolean;
  target_scope: string;
  department_ids: string[];
  publish_at: string | null;
  expires_at: string | null;
  created_by_name: string | null;
  read_count: number;
  created_at: string;
}

export type AnnouncementPayload = ReturnType<typeof announcementPayload>;
