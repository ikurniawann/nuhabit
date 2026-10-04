import { parseVideoUrl } from "./announcement-video";

/**
 * Logika murni editor pengumuman HRIS: nilai form, validasi sebelum simpan,
 * dan konversi waktu tayang untuk input datetime-local.
 */

export type AnnouncementStatus = "draft" | "published";
export type AnnouncementScope = "global" | "department";

interface AnnouncementForm {
  title: string;
  body_html: string;
  cover_image_url: string | null;
  video_url: string;
  tags: string[];
  status: AnnouncementStatus;
  is_pinned: boolean;
  target_scope: AnnouncementScope;
  department_ids: string[];
  /** Nilai input datetime-local (waktu lokal browser) atau "". */
  publish_at: string;
  expires_at: string;
}

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementForm = {
  title: "",
  body_html: "",
  cover_image_url: null,
  video_url: "",
  tags: [],
  status: "draft",
  is_pinned: false,
  target_scope: "global",
  department_ids: [],
  publish_at: "",
  expires_at: "",
};

/** ISO (UTC Z) → nilai input datetime-local (waktu lokal). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Provider + id tersimpan → URL tonton yang bisa diedit ulang. */
export function videoWatchUrl(provider: string | null, videoId: string | null): string {
  if (!provider || !videoId) return "";
  return provider === "youtube" ? `https://youtu.be/${videoId}` : `https://vimeo.com/${videoId}`;
}

export function announcementFormFrom(a: {
  title: string;
  body_html: string;
  cover_image_url: string | null;
  video_provider: string | null;
  video_id: string | null;
  tags: string[] | null;
  status: string;
  is_pinned: boolean;
  target_scope: string;
  department_ids: string[] | null;
  publish_at: string | null;
  expires_at: string | null;
}): AnnouncementForm {
  return {
    title: a.title,
    body_html: a.body_html,
    cover_image_url: a.cover_image_url,
    video_url: videoWatchUrl(a.video_provider, a.video_id),
    tags: a.tags ?? [],
    status: a.status === "published" ? "published" : "draft",
    is_pinned: a.is_pinned,
    target_scope: a.target_scope === "department" ? "department" : "global",
    department_ids: a.department_ids ?? [],
    publish_at: isoToLocalInput(a.publish_at),
    expires_at: isoToLocalInput(a.expires_at),
  };
}

/** Pesan galat pertama, atau null bila form siap disimpan. */
export function validateAnnouncementForm(form: AnnouncementForm): string | null {
  if (!form.title.trim()) return "Judul wajib diisi";
  if (form.video_url.trim() && !parseVideoUrl(form.video_url)) {
    return "URL video harus YouTube atau Vimeo yang valid";
  }
  if (form.target_scope === "department" && form.department_ids.length === 0) {
    return "Pilih minimal satu departemen atau ubah target ke global";
  }
  return null;
}

export function announcementPayload(form: AnnouncementForm) {
  return {
    title: form.title.trim(),
    body_html: form.body_html,
    cover_image_url: form.cover_image_url,
    video_url: form.video_url.trim() || null,
    tags: form.tags,
    status: form.status,
    is_pinned: form.is_pinned,
    target_scope: form.target_scope,
    department_ids: form.target_scope === "department" ? form.department_ids : [],
    publish_at: localInputToIso(form.publish_at),
    expires_at: localInputToIso(form.expires_at),
  };
}

/** Tambah tag yang sudah dirapikan; kosong atau duplikat → daftar tetap. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = raw.trim();
  return !tag || tags.includes(tag) ? tags : [...tags, tag];
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((d) => d !== id) : [...ids, id];
}
