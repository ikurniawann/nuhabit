"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { BadgeMetric } from "@/lib/member-portal/badges";
import { DEFAULT_POS_LOYALTY_SETTINGS, idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";
import { memberApi } from "./api";

/**
 * Hook fitur member yang dulu hidup di portal tab lama (/member/v1): ARK Coin,
 * top-up, reward, badge, koleksi, ulasan, event & challenge CRM, riwayat order.
 * Semuanya memakai API /api/member-portal/* yang sudah ada.
 */
export const loyaltyKeys = {
  me: ["member-app", "loyalty", "me"] as const,
  transactions: ["member-app", "loyalty", "transactions"] as const,
  order: (id: string) => ["member-app", "loyalty", "order", id] as const,
  outletVisits: ["member-app", "loyalty", "outlet-visits"] as const,
  bill: ["member-app", "loyalty", "bill"] as const,
  topupOptions: ["member-app", "loyalty", "topup"] as const,
  topup: (id: string) => ["member-app", "loyalty", "topup", id] as const,
  rewards: ["member-app", "loyalty", "rewards"] as const,
  badges: ["member-app", "loyalty", "badges"] as const,
  collection: (kind: CollectionKind) => ["member-app", "loyalty", "collection", kind] as const,
  reviews: ["member-app", "loyalty", "reviews"] as const,
  events: ["member-app", "loyalty", "events"] as const,
  challenges: ["member-app", "loyalty", "challenges"] as const,
};

/* ── Profil loyalitas (/me) ─────────────────────────────────────────── */

export interface TierView {
  code: string;
  name: string;
  minLifetimeXp: number;
  discountPercent: number;
}

export interface LoyaltyMe {
  profile: {
    name: string | null;
    birthDate: string | null;
    gender: string | null;
    city: string | null;
  };
  /** Saldo ARK untuk tampilan; `coinsIdr` saldo mentah dalam Rupiah. */
  coins: number;
  coinsIdr: number;
  arkRate: number;
  lowBalanceThresholdIdr: number;
  marketingOptIn: boolean;
  totalXp: number;
  tier: { code: string; name: string; discountPercent: number } | null;
  nextTier: { name: string; minLifetimeXp: number; xpNeeded: number } | null;
  tiers: TierView[];
}

interface MeRaw {
  profile: {
    name: string | null;
    birth_date: string | null;
    gender: string | null;
    city: string | null;
  };
  ark_coin_balance: number;
  ark_rate: number;
  low_balance_threshold_idr: number;
  marketing_opt_in: boolean;
  total_xp: number;
  tier: { code: string; name: string; discount_percent: number } | null;
  next_tier: { name: string; min_lifetime_xp: number; xp_needed: number } | null;
  tiers?: Array<{ code: string; name: string; min_lifetime_xp: number; discount_percent: number }>;
}

async function fetchLoyaltyMe(): Promise<LoyaltyMe> {
  const d = await memberApi<MeRaw>("/me");
  const arkRate = Number(d.ark_rate) || DEFAULT_POS_LOYALTY_SETTINGS.ark_rate;
  const coinsIdr = Number(d.ark_coin_balance) || 0;
  return {
    profile: {
      name: d.profile.name,
      birthDate: d.profile.birth_date,
      gender: d.profile.gender,
      city: d.profile.city,
    },
    coins: idrToArkDisplay(coinsIdr, arkRate),
    coinsIdr,
    arkRate,
    lowBalanceThresholdIdr: Number(d.low_balance_threshold_idr) || 0,
    marketingOptIn: d.marketing_opt_in === true,
    totalXp: Number(d.total_xp) || 0,
    tier: d.tier
      ? { code: d.tier.code, name: d.tier.name, discountPercent: Number(d.tier.discount_percent) || 0 }
      : null,
    nextTier: d.next_tier
      ? {
          name: d.next_tier.name,
          minLifetimeXp: Number(d.next_tier.min_lifetime_xp) || 0,
          xpNeeded: Number(d.next_tier.xp_needed) || 0,
        }
      : null,
    tiers: (d.tiers ?? []).map((t) => ({
      code: t.code,
      name: t.name,
      minLifetimeXp: Number(t.min_lifetime_xp) || 0,
      discountPercent: Number(t.discount_percent) || 0,
    })),
  };
}

export const useLoyaltyMe = () => useQuery({ queryKey: loyaltyKeys.me, queryFn: fetchLoyaltyMe });

/* ── Riwayat koin & order ───────────────────────────────────────────── */

export interface CoinTxn {
  id: string;
  type: string;
  /** Rupiah bertanda dari API (debit negatif). */
  amountIdr: number;
  createdAt: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  totalIdr: number;
  paidWithArk: boolean;
  createdAt: string;
}

export const useTransactions = () =>
  useQuery({
    queryKey: loyaltyKeys.transactions,
    queryFn: async () => {
      const data = await memberApi<{
        wallet: Array<{ id: string; type: string; amount: number; created_at: string }>;
        orders: Array<{
          id: string;
          order_number: string;
          total_amount: number;
          payment_method: string | null;
          created_at: string;
        }>;
      }>("/transactions");
      return {
        wallet: (data.wallet ?? []).map((r): CoinTxn => ({
          id: r.id,
          type: r.type,
          amountIdr: Number(r.amount) || 0,
          createdAt: r.created_at,
        })),
        orders: (data.orders ?? []).map((r): OrderSummary => ({
          id: r.id,
          orderNumber: r.order_number,
          totalIdr: Number(r.total_amount) || 0,
          paidWithArk: isArkCoinMethod(r.payment_method),
          createdAt: r.created_at,
        })),
      };
    },
  });

/** Detail order dari GET /orders/:id (struk). */
export interface OrderDetail {
  order: {
    order_number: string;
    ordered_at: string;
    total_amount: number;
    discount_amount: number;
    discount_reason: string | null;
    payment_method: string | null;
    ark_coins_used: number;
    venue_name: string | null;
    subtotal: number;
  };
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    discount_amount: number;
    total_amount: number;
  }>;
  xp_earned: number;
  ark_rate: number;
}

export const useOrderDetail = (id: string) =>
  useQuery({
    queryKey: loyaltyKeys.order(id),
    queryFn: () => memberApi<OrderDetail>(`/orders/${encodeURIComponent(id)}`),
  });

/** Kunjungan per outlet (dihitung dari order POS). */
export interface OutletVisits {
  visit_count: number;
  venues: Array<{ venue_name: string; order_count: number; day_count: number; last_visit_at: string }>;
}

export const useOutletVisits = () =>
  useQuery({ queryKey: loyaltyKeys.outletVisits, queryFn: () => memberApi<OutletVisits>("/visits") });

/** Tagihan Member: order belum lunas yang dibayar belakangan di kasir (cicil boleh). */
export interface MemberBill {
  balance: { openTotal: number; credit: number; outstanding: number; surplus: number; canSettle: boolean };
  open_orders: Array<{
    id: string;
    order_number: string | null;
    ordered_at: string;
    total_amount: number;
    items: Array<{ name: string; quantity: number; total_amount: number; options: string[] }>;
  }>;
  payments: Array<{ id: string; amount: number; method: string; created_at: string }>;
}

export const useMemberBill = () =>
  useQuery({ queryKey: loyaltyKeys.bill, queryFn: () => memberApi<MemberBill>("/bills") });

/* ── Top-up ARK Coin (QRIS) ─────────────────────────────────────────── */

export interface TopupPackageOption {
  id: string;
  name: string;
  description: string;
  price_idr: number;
  credit_idr: number;
  bonus_idr: number;
  validity_days: number | null;
}

export interface TopupOptions {
  balance: number;
  ark_rate: number;
  min_amount: number;
  max_amount: number;
  presets: number[];
  packages: TopupPackageOption[];
  pending_id: string | null;
  can_simulate: boolean;
}

export interface ArkTopup {
  id: string;
  status: "pending" | "completed" | "expired" | "failed" | "cancelled";
  amount: number;
  credit_idr: number;
  package_name: string | null;
  qr_string: string | null;
  expires_at: string | null;
  simulated: boolean;
  balance_after: number;
}

export type TopupChoice = { packageId: string } | { amount: number };

export const useTopupOptions = () =>
  useQuery({ queryKey: loyaltyKeys.topupOptions, queryFn: () => memberApi<TopupOptions>("/topup") });

const TOPUP_POLL_MS = 4_000;

export const useArkTopup = (id: string) =>
  useQuery({
    queryKey: loyaltyKeys.topup(id),
    queryFn: () => memberApi<ArkTopup>(`/topup/${encodeURIComponent(id)}`),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? TOPUP_POLL_MS : false),
  });

export const createArkTopup = (choice: TopupChoice) =>
  memberApi<ArkTopup>("/topup", {
    method: "POST",
    json: "packageId" in choice ? { package_id: choice.packageId } : { amount: choice.amount },
  });

export const simulateArkTopupPaid = (id: string) =>
  memberApi<ArkTopup>(`/topup/${encodeURIComponent(id)}/simulate-paid`, { method: "POST", json: {} });

/* ── Reward, badge, koleksi ─────────────────────────────────────────── */

export interface Reward {
  id: string;
  name: string;
  min_xp: number;
  required_tier_name: string | null;
  image_url: string | null;
  eligible: boolean;
  reason: string | null;
  xp_needed: number;
  remaining_stock: number | null;
}

export interface Redemption {
  id: string;
  redemption_number: string;
  status: string;
  requested_at: string;
  reward_name: string;
}

export const useRewards = () =>
  useQuery({
    queryKey: loyaltyKeys.rewards,
    queryFn: () => memberApi<{ member: { total_xp: number }; rewards: Reward[]; history: Redemption[] }>("/rewards"),
  });

export const redeemReward = (rewardId: string) =>
  memberApi<Redemption>("/rewards", { method: "POST", json: { reward_id: rewardId } });

export interface Badge {
  id: string;
  name: string;
  image_url: string | null;
  min_lifetime_xp: number;
  metric: BadgeMetric;
  threshold: number | null;
  owned: boolean;
  is_showcased: boolean;
}

export const useBadges = () =>
  useQuery({
    queryKey: loyaltyKeys.badges,
    queryFn: () => memberApi<{ total_xp: number; badges: Badge[] }>("/badges"),
  });

export const setBadgeShowcased = (badgeId: string, showcased: boolean) =>
  memberApi("/badges", { method: "POST", json: { badge_id: badgeId, showcased } });

export type CollectionKind = "avatar" | "wallpaper";

export interface Collectible {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "limited";
  image_url: string;
  thumbnail_url: string | null;
  owned: boolean;
  equipped?: boolean;
  locked_reason: string | null;
  xp_needed: number;
}

export interface CollectionData {
  entitlement: { remaining: number; interval_xp: number };
  items: Collectible[];
}

export const useCollection = (kind: CollectionKind) =>
  useQuery({
    queryKey: loyaltyKeys.collection(kind),
    queryFn: () => memberApi<CollectionData>(kind === "avatar" ? "/collectibles" : "/wallpapers"),
  });

export const redeemCollectible = (kind: CollectionKind, id: string) =>
  kind === "avatar"
    ? memberApi("/collectibles/redeem", { method: "POST", json: { avatar_id: id } })
    : memberApi("/wallpapers/redeem", { method: "POST", json: { wallpaper_id: id } });

export const equipAvatar = (id: string) =>
  memberApi("/collectibles/equip", { method: "POST", json: { avatar_id: id } });

/* ── Ulasan ─────────────────────────────────────────────────────────── */

export interface ReviewableOrder {
  id: string;
  order_number: string;
  total_amount: number;
  paid_at: string;
  outlet_name: string | null;
  review_until: string;
}

export interface MyReview {
  id: string;
  order_number: string;
  outlet_name: string | null;
  rating: number;
  comment: string | null;
  reply: string | null;
  created_at: string;
}

export const useReviews = () =>
  useQuery({
    queryKey: loyaltyKeys.reviews,
    queryFn: () => memberApi<{ eligible: ReviewableOrder[]; reviews: MyReview[] }>("/reviews"),
  });

export const submitReview = (orderId: string, rating: number, comment: string | null) =>
  memberApi("/reviews", { method: "POST", json: { order_id: orderId, rating, comment } });

/* ── Event & challenge CRM ──────────────────────────────────────────── */

export interface CrmEvent {
  id: string;
  title: string;
  description: string;
  host_name: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  price_idr: number;
  cancel_deadline_hours: number;
  confirmed_count: number;
  booking_id: string | null;
  booking_status: "confirmed" | "waitlist" | "attended" | "no_show" | null;
  waitlist_position: number | null;
}

export const useCrmEvents = () =>
  useQuery({ queryKey: loyaltyKeys.events, queryFn: () => memberApi<CrmEvent[]>("/events") });

export const bookCrmEvent = (eventId: string) =>
  memberApi<{ kind: "confirm" | "waitlist"; position?: number }>("/events", {
    method: "POST",
    json: { event_id: eventId },
  });

export const cancelCrmEvent = (bookingId: string) =>
  memberApi(`/events?booking_id=${encodeURIComponent(bookingId)}`, { method: "DELETE" });

export interface CrmChallenge {
  id: string;
  title: string;
  description: string;
  metric: "visits" | "spend";
  target: number;
  starts_at: string;
  ends_at: string;
  reward_xp: number;
  reward_ark_idr: number;
  phase: "upcoming" | "running" | "ended";
  joined: boolean;
  rewarded_at: string | null;
  participant_count: number;
  progress: { value: number; target: number; pct: number; completed: boolean } | null;
  my_rank: number | null;
  leaderboard: Array<{ rank: number; name: string; value: number; is_me: boolean }>;
}

export const useCrmChallenges = () =>
  useQuery({ queryKey: loyaltyKeys.challenges, queryFn: () => memberApi<CrmChallenge[]>("/challenges") });

export const joinCrmChallenge = (challengeId: string) =>
  memberApi("/challenges", { method: "POST", json: { challenge_id: challengeId } });

/** Muat ulang satu kelompok data setelah aksi member. */
export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(
    (...keys: ReadonlyArray<readonly unknown[]>) =>
      Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
    [qc],
  );
}
