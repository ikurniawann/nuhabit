import "server-only";
import { appOrigin } from "@/lib/app-origin";
import { backendUrl } from "@/lib/env";
import { withDefaults } from "../content-defaults";
import type { Article, BranchProfile, BranchSummary, ContentByKey, ContentKey, SiteEvent } from "../types";

/**
 * Server-side reads of the public site API. Pages render from these; a
 * failed request yields the defaults or an empty list so the shell still
 * renders during an API outage.
 */

function base(): string {
  return backendUrl() || appOrigin();
}

async function read<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base()}/api/public/site${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    return json.success ? (json.data ?? null) : null;
  } catch (error) {
    console.error(`[site] fetch ${path} failed:`, error);
    return null;
  }
}

export async function fetchContent<K extends ContentKey>(key: K): Promise<ContentByKey[K]> {
  return withDefaults(key, await read<unknown>(`/content/${key}`));
}

export async function fetchBranches(): Promise<BranchSummary[]> {
  return (await read<BranchSummary[]>("/branches")) ?? [];
}

export function fetchBranch(slug: string): Promise<BranchProfile | null> {
  return read<BranchProfile>(`/branches/${encodeURIComponent(slug)}`);
}

export async function fetchArticles(category?: string): Promise<Article[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  return (await read<Article[]>(`/articles${query}`)) ?? [];
}

export function fetchArticle(slug: string): Promise<Article | null> {
  return read<Article>(`/articles/${encodeURIComponent(slug)}`);
}

export async function fetchEvents(): Promise<SiteEvent[]> {
  return (await read<SiteEvent[]>("/events")) ?? [];
}

export function fetchEvent(slug: string): Promise<SiteEvent | null> {
  return read<SiteEvent>(`/events/${encodeURIComponent(slug)}`);
}
