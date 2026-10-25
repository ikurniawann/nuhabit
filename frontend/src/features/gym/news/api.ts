/** Klien API Gym → News Member (Go /api/gym/news, artikel site.articles untuk aplikasi member). */
import { call, remove, send, upload } from "../shared";

export type NewsCategory = "news" | "event" | "tips" | "promo";
export type NewsStatus = "draft" | "published";

export interface NewsArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  body_md: string;
  status: NewsStatus;
  published_at: string | null;
  updated_at: string;
  audience: "members" | "both";
  member_category: NewsCategory;
  pinned: boolean;
  branch_ids: string[];
}

export interface NewsView {
  news: NewsArticle[];
  branches: { id: string; name: string }[];
}

export interface NewsPayload {
  title: string;
  member_category: NewsCategory;
  excerpt: string | null;
  body_md: string;
  cover_image_url: string | null;
  status: NewsStatus;
  published_at: string | null;
  pinned: boolean;
  also_on_site: boolean;
  branch_ids: string[];
}

export const newsApi = {
  list: () => call<NewsView>("/api/gym/news"),
  create: (payload: NewsPayload) => send<NewsArticle>("/api/gym/news", payload),
  update: (id: string, payload: NewsPayload) => send<NewsArticle>(`/api/gym/news/${id}`, payload, "PATCH"),
  remove: (id: string) => remove<{ id: string }>(`/api/gym/news/${id}`),
  uploadCover: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return upload<{ url: string }>("/api/gym/news/uploads", body);
  },
};

export const NEWS_KEYS = { list: ["gym", "news"] as const };

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  news: "Berita",
  event: "Event",
  tips: "Tips latihan",
  promo: "Promo",
};

/** Form editor: teks input apa adanya. */
export interface NewsForm {
  title: string;
  member_category: NewsCategory;
  excerpt: string;
  body_md: string;
  cover_image_url: string;
  status: NewsStatus;
  /** datetime-local di zona browser; kosong = saat diterbitkan. */
  published_at: string;
  pinned: boolean;
  also_on_site: boolean;
  branch_ids: string[];
}

/** "YYYY-MM-DDTHH:mm" di zona browser untuk input datetime-local. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initialNewsForm(article: NewsArticle | null): NewsForm {
  return {
    title: article?.title ?? "",
    member_category: article?.member_category ?? "news",
    excerpt: article?.excerpt ?? "",
    body_md: article?.body_md ?? "",
    cover_image_url: article?.cover_image_url ?? "",
    status: article?.status ?? "draft",
    published_at: localInput(article?.published_at ?? null),
    pinned: article?.pinned ?? false,
    also_on_site: article?.audience === "both",
    branch_ids: article?.branch_ids ?? [],
  };
}

export function toNewsPayload(form: NewsForm): NewsPayload {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    title: form.title.trim(),
    member_category: form.member_category,
    excerpt: blank(form.excerpt),
    body_md: form.body_md,
    cover_image_url: blank(form.cover_image_url),
    status: form.status,
    published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
    pinned: form.pinned,
    also_on_site: form.also_on_site,
    branch_ids: form.branch_ids,
  };
}

/** Status tampilan: draf, terjadwal (terbit di masa depan) atau terbit. */
export function newsState(article: Pick<NewsArticle, "status" | "published_at">, now = Date.now()): "draft" | "scheduled" | "live" {
  if (article.status === "draft") return "draft";
  return article.published_at && new Date(article.published_at).getTime() > now ? "scheduled" : "live";
}
