"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivityCardView,
  ActivityCommentView,
  ActivityDetailView,
  ActivityPatch,
  AthleteLite,
  AthleteSettingsView,
  AthleteStatsView,
  ChallengeView,
  GearInput,
  GearView,
  RouteView,
  SaveActivityInput,
  SegmentView,
} from "@/lib/gym/athlete-server";
import type { TrackPoint } from "@/lib/gym/athlete";
import { memberApi } from "./api";

/**
 * Data tab Train (port apps/member/src/lib/athlete-queries.ts). Rute API ada
 * di /api/member-portal/app/train/*; bentuk respons = kontrak referensi.
 */

export type {
  ActivityCardView,
  ActivityDetailView,
  AthleteSettingsView,
  AthleteStatsView,
  ChallengeView,
  GearView,
  RouteView,
  TrackPoint,
};
export type ActivityType = ActivityCardView["type"];
export type ActivityVisibility = ActivityCardView["visibility"];

export interface SegmentListView {
  segment: SegmentView;
  effortCount: number;
  bestElapsedSec: number | null;
  myBestElapsedSec: number | null;
  myRank: number | null;
}

export interface SegmentDetailView {
  segment: SegmentView;
  leaderboard: {
    rank: number;
    memberId: string;
    memberName: string;
    elapsedSec: number;
    createdAt: string;
    isMe: boolean;
  }[];
  myRank: number | null;
}

export interface ClubView {
  club: {
    id: string;
    name: string;
    description: string;
    location: string;
    memberIds: string[];
  };
  joined: boolean;
  memberCount: number;
  weeklyLeaderboard: { memberName: string; km: number; isMe: boolean }[];
}

export interface SocialView {
  following: AthleteLite[];
  followers: AthleteLite[];
  suggestions: AthleteLite[];
}

export interface AthleteProfileView {
  member: { id: string; fullName: string; avatarUrl: string | null };
  isMe: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  totals: { activities: number; distanceKm: number; movingSec: number };
  activities: ActivityCardView[];
}

const T = "/app/train";
const post = <R>(path: string, json?: unknown) =>
  memberApi<R>(`${T}${path}`, { method: "POST", json });

export const trainApi = {
  feed: (scope: "everyone" | "following") =>
    memberApi<ActivityCardView[]>(`${T}/feed?scope=${scope}`),
  myActivities: () => memberApi<ActivityCardView[]>(`${T}/activities`),
  save: (input: SaveActivityInput) =>
    post<ActivityCardView>("/activities", input),
  activity: (id: string) =>
    memberApi<ActivityDetailView>(`${T}/activities/${id}`),
  updateActivity: (id: string, input: ActivityPatch) =>
    memberApi<ActivityCardView>(`${T}/activities/${id}`, {
      method: "PATCH",
      json: input,
    }),
  deleteActivity: (id: string) =>
    memberApi<{ deleted: true }>(`${T}/activities/${id}`, { method: "DELETE" }),
  routes: () => memberApi<RouteView[]>(`${T}/routes`),
  saveRoute: (activityId: string, name: string) =>
    post<RouteView>("/routes", { activityId, name }),
  deleteRoute: (id: string) =>
    memberApi<{ ok: true }>(`${T}/routes/${id}`, { method: "DELETE" }),
  heatmap: () => memberApi<{ tracks: TrackPoint[][] }>(`${T}/heatmap`),
  toggleKudos: (id: string) =>
    post<{ kudoed: boolean; count: number }>(`/activities/${id}/kudos`),
  comment: (id: string, text: string) =>
    post<ActivityCommentView>(`/activities/${id}/comments`, { text }),
  stats: () => memberApi<AthleteStatsView>(`${T}/stats`),
  segments: () => memberApi<SegmentListView[]>(`${T}/segments`),
  segment: (id: string) => memberApi<SegmentDetailView>(`${T}/segments/${id}`),
  challenges: () => memberApi<ChallengeView[]>(`${T}/challenges`),
  joinChallenge: (id: string) =>
    post<{ joined: true }>(`/challenges/${id}/join`),
  clubs: () => memberApi<ClubView[]>(`${T}/clubs`),
  toggleClub: (id: string) => post<{ joined: boolean }>(`/clubs/${id}/toggle`),
  social: () => memberApi<SocialView>(`${T}/social`),
  profile: (memberId: string) =>
    memberApi<AthleteProfileView>(`${T}/athletes/${memberId}`),
  toggleFollow: (memberId: string) =>
    post<{ following: boolean }>(`/follow/${memberId}`),
  createGear: (input: GearInput) => post<GearView>("/gear", input),
  updateGear: (id: string, input: GearInput) =>
    memberApi<GearView>(`${T}/gear/${id}`, { method: "PATCH", json: input }),
  settings: () => memberApi<AthleteSettingsView>(`${T}/settings`),
  updateSettings: (input: Partial<AthleteSettingsView>) =>
    memberApi<AthleteSettingsView>(`${T}/settings`, {
      method: "PUT",
      json: input,
    }),
};

export const athleteKeys = {
  feed: (scope: string) => ["athlete", "feed", scope] as const,
  mine: ["athlete", "mine"] as const,
  activity: (id: string) => ["athlete", "activity", id] as const,
  stats: ["athlete", "stats"] as const,
  segments: ["athlete", "segments"] as const,
  segment: (id: string) => ["athlete", "segment", id] as const,
  challenges: ["athlete", "challenges"] as const,
  clubs: ["athlete", "clubs"] as const,
  social: ["athlete", "social"] as const,
  settings: ["athlete", "settings"] as const,
  routes: ["athlete", "routes"] as const,
  heatmap: ["athlete", "heatmap"] as const,
  profile: (id: string) => ["athlete-profile", id] as const,
};

export const useFeed = (scope: "everyone" | "following") =>
  useQuery({
    queryKey: athleteKeys.feed(scope),
    queryFn: () => trainApi.feed(scope),
  });
export const useMyActivities = () =>
  useQuery({ queryKey: athleteKeys.mine, queryFn: trainApi.myActivities });
export const useActivity = (id: string) =>
  useQuery({
    queryKey: athleteKeys.activity(id),
    queryFn: () => trainApi.activity(id),
    enabled: Boolean(id),
  });
export const useAthleteStats = () =>
  useQuery({ queryKey: athleteKeys.stats, queryFn: trainApi.stats });
export const useSegments = () =>
  useQuery({ queryKey: athleteKeys.segments, queryFn: trainApi.segments });
export const useSegment = (id: string) =>
  useQuery({
    queryKey: athleteKeys.segment(id),
    queryFn: () => trainApi.segment(id),
    enabled: Boolean(id),
  });
export const useChallenges = () =>
  useQuery({ queryKey: athleteKeys.challenges, queryFn: trainApi.challenges });
export const useClubs = () =>
  useQuery({ queryKey: athleteKeys.clubs, queryFn: trainApi.clubs });
export const useSocial = () =>
  useQuery({ queryKey: athleteKeys.social, queryFn: trainApi.social });
export const useAthleteSettings = () =>
  useQuery({ queryKey: athleteKeys.settings, queryFn: trainApi.settings });
export const useRoutes = () =>
  useQuery({ queryKey: athleteKeys.routes, queryFn: trainApi.routes });
export const useHeatmap = () =>
  useQuery({ queryKey: athleteKeys.heatmap, queryFn: trainApi.heatmap });
export const useAthleteProfile = (memberId: string) =>
  useQuery({
    queryKey: athleteKeys.profile(memberId),
    queryFn: () => trainApi.profile(memberId),
    enabled: Boolean(memberId),
  });

/** Preferensi satuan, METRIC selama memuat. */
export function useUnits(): "METRIC" | "IMPERIAL" {
  const { data } = useAthleteSettings();
  return data?.units ?? "METRIC";
}

/** Perubahan atlet menyentuh banyak layar sekaligus: segarkan semuanya. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries();
}

export function useKudosMutation() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: trainApi.toggleKudos,
    onSuccess: invalidate,
  });
}

export function useFollowMutation() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: trainApi.toggleFollow,
    onSuccess: invalidate,
  });
}
