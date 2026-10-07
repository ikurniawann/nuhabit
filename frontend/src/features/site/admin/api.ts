import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import type { Article, ContentKey, SiteEvent } from "../types";

type Envelope<T> = { success: boolean; data: T };

const BASE = "/api/site";

export type ArticleInput = Partial<Omit<Article, "id" | "created_at" | "updated_at">>;
export type EventInput = Partial<Omit<SiteEvent, "id" | "created_at" | "updated_at">>;

async function remove(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Gagal menghapus");
}

export const siteAdminApi = {
  content: (key: ContentKey) => apiGet<Envelope<Record<string, unknown>>>(`${BASE}/content/${key}`).then((r) => r.data),
  saveContent: (key: ContentKey, value: Record<string, unknown>) =>
    apiPut<Envelope<Record<string, unknown>>>(`${BASE}/content/${key}`, value).then((r) => r.data),

  articles: () => apiGet<Envelope<Article[]>>(`${BASE}/articles`).then((r) => r.data),
  createArticle: (body: ArticleInput) => apiPost<Envelope<Article>>(`${BASE}/articles`, body).then((r) => r.data),
  updateArticle: (id: string, body: ArticleInput) => apiPatch<Envelope<Article>>(`${BASE}/articles/${id}`, body).then((r) => r.data),
  deleteArticle: (id: string) => remove(`${BASE}/articles/${id}`),

  events: () => apiGet<Envelope<SiteEvent[]>>(`${BASE}/events`).then((r) => r.data),
  createEvent: (body: EventInput) => apiPost<Envelope<SiteEvent>>(`${BASE}/events`, body).then((r) => r.data),
  updateEvent: (id: string, body: EventInput) => apiPatch<Envelope<SiteEvent>>(`${BASE}/events/${id}`, body).then((r) => r.data),
  deleteEvent: (id: string) => remove(`${BASE}/events/${id}`),

  async upload(file: File): Promise<string> {
    const data = new FormData();
    data.append("file", file);
    const res = await fetch(`${BASE}/uploads`, { method: "POST", body: data });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { url: string } };
    if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Upload gagal");
    return json.data.url;
  },
};
