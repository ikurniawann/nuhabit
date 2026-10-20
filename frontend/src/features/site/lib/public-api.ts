import "server-only";
import { appOrigin } from "@/lib/app-origin";
import { backendUrl } from "@/lib/env";
import { withDefaults } from "../content-defaults";
import { addDays, weekWindow, type PublicSession, type PublicTimetable } from "./timetable";
import { withCoachPhotos, type GymCoachPhoto } from "./training";
import type { Article, BranchProfile, BranchSummary, ContentByKey, ContentKey, PublicPlansView, SiteEvent } from "../types";

/**
 * Server-side reads of the public site API. Pages render from these; a
 * failed request yields the defaults or an empty list so the shell still
 * renders during an API outage.
 */

function base(): string {
  return backendUrl() || appOrigin();
}

async function read<T>(path: string): Promise<T | null> {
  const origin = base();
  // Without an API origin, server-side fetch cannot resolve a relative URL.
  // Public pages use their defaults until the Go API is configured.
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/api/public/site${path}`, { cache: "no-store" });
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

/** Training content with each coach's gym profile photo where the content has none. */
export async function fetchTraining(): Promise<ContentByKey["training"]> {
  const [training, coaches] = await Promise.all([fetchContent("training"), read<GymCoachPhoto[]>("/coaches")]);
  return { ...training, coaches: withCoachPhotos(training.coaches, coaches ?? []) };
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

/** Every bookable class at a branch across the current and next week, soonest first. */
export async function fetchSessionsAhead(branchSlug: string, now = new Date()): Promise<PublicSession[]> {
  const monday = weekWindow(now).first;
  const weeks = [monday, addDays(monday, 7)];
  const timetables = await Promise.all(weeks.map((week) =>
    read<PublicTimetable>(`/sessions?branch=${encodeURIComponent(branchSlug)}&week=${week}`)
  ));
  return timetables.flatMap((table) => table?.sessions ?? [])
    .filter((session) => new Date(session.starts_at).getTime() > now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** The next few classes at the visitor's branch. */
export async function fetchUpcomingSessions(branchSlug: string, now = new Date()): Promise<PublicSession[]> {
  return (await fetchSessionsAhead(branchSlug, now)).slice(0, 3);
}

export interface BranchSession extends PublicSession {
  branch: Pick<BranchSummary, "slug" | "name">;
}

/** Upcoming classes at every branch, each tagged with its branch, soonest first. */
export async function fetchAllSessionsAhead(branches: BranchSummary[], now = new Date()): Promise<BranchSession[]> {
  const perBranch = await Promise.all(branches.map(async (branch) =>
    (await fetchSessionsAhead(branch.slug, now)).map((session) => ({ ...session, branch: { slug: branch.slug, name: branch.name } }))
  ));
  return perBranch.flat().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function fetchEvent(slug: string): Promise<SiteEvent | null> {
  return read<SiteEvent>(`/events/${encodeURIComponent(slug)}`);
}

const NO_PLANS: PublicPlansView = { branch: null, plans: [] };

/** The price list of a branch; an unknown slug falls back to the base prices. */
export async function fetchPlans(branchSlug?: string): Promise<PublicPlansView> {
  if (branchSlug) {
    const priced = await read<PublicPlansView>(`/plans?branch=${encodeURIComponent(branchSlug)}`);
    if (priced) return priced;
  }
  return (await read<PublicPlansView>("/plans")) ?? NO_PLANS;
}
