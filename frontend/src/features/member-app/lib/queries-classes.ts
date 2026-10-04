"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { memberApi } from "./api";
import {
  inBranch,
  toBookingView,
  toPackageView,
  toPaymentView,
  toSessionView,
  toTrainerViews,
  toWalletView,
  type RawBooking,
  type RawCatalog,
  type RawCoach,
  type RawPackage,
  type RawPurchase,
  type RawSession,
  type RawWallet,
} from "./classes-view";

/**
 * Data hooks for the classes & wallet screens (reference lib/queries.ts),
 * mapped onto /api/member-portal/gym/* and /app/classes/catalog.
 */

const keys = {
  catalog: ["member-app", "classes-catalog"] as const,
  sessions: ["member-app", "sessions"] as const,
  trainers: (branchId?: string) => ["member-app", "trainers", branchId ?? "all"] as const,
  trainer: (id: string) => ["member-app", "trainer", id] as const,
  session: (id: string) => ["member-app", "session", id] as const,
  bookings: ["member-app", "bookings"] as const,
  wallet: ["member-app", "wallet"] as const,
  packages: ["member-app", "packages"] as const,
  payment: (id: string) => ["member-app", "payment", id] as const,
};

/** Trainer browsing covers the next fortnight, like the reference. */
const WINDOW_DAYS = 14;
const PAYMENT_POLL_MS = 4_000;

const catalogOptions = {
  queryKey: keys.catalog,
  queryFn: () => memberApi<RawCatalog>("/app/classes/catalog"),
  staleTime: 5 * 60_000,
};
const loadCatalog = (qc: QueryClient) => qc.ensureQueryData(catalogOptions);

async function loadSessions(qc: QueryClient) {
  const to = new Date(Date.now() + WINDOW_DAYS * 86_400_000).toISOString();
  const [res, catalog] = await Promise.all([
    memberApi<{ sessions: RawSession[] }>(`/gym/sessions?${new URLSearchParams({ to })}`),
    loadCatalog(qc),
  ]);
  return res.sessions.map((s) => toSessionView(s, catalog));
}

export const useBranches = () => useQuery({ ...catalogOptions, select: (c: RawCatalog) => c.branches });

export const useClassTypes = () => useQuery({ ...catalogOptions, select: (c: RawCatalog) => c.class_types });

export function useSessions(branchId?: string, coachId?: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.sessions,
    queryFn: () => loadSessions(qc),
    select: (list) =>
      list.filter((v) => inBranch(v.session.branchId, branchId) && (!coachId || v.session.coachId === coachId)),
  });
}

/** Coaches members can book, with what each has coming up. */
export function useTrainers(branchId?: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.trainers(branchId),
    queryFn: async () => {
      const [coaches, sessions, catalog] = await Promise.all([
        memberApi<RawCoach[]>("/gym/coaches"),
        qc.ensureQueryData({ queryKey: keys.sessions, queryFn: () => loadSessions(qc) }),
        loadCatalog(qc),
      ]);
      return toTrainerViews(coaches, sessions, catalog, branchId);
    },
  });
}

export function useTrainer(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.trainer(id),
    queryFn: async () => {
      const [raw, catalog] = await Promise.all([
        memberApi<RawCoach & { sessions: RawSession[] }>(`/gym/coaches/${id}`),
        loadCatalog(qc),
      ]);
      const upcoming = raw.sessions.map((s) => toSessionView(s, catalog));
      const [trainer] = toTrainerViews([raw], upcoming, catalog);
      return { ...trainer!, upcoming };
    },
    enabled: Boolean(id),
  });
}

export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.session(id),
    queryFn: async () => {
      const [raw, catalog] = await Promise.all([memberApi<RawSession>(`/gym/sessions/${id}`), loadCatalog(qc)]);
      return toSessionView(raw, catalog);
    },
    enabled: Boolean(id),
  });
}

/** Upcoming and past bookings in one list; the screen splits them like the reference. */
export function useMyBookings() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.bookings,
    queryFn: async () => {
      const [upcoming, past, catalog] = await Promise.all([
        memberApi<RawBooking[]>("/gym/bookings?scope=upcoming"),
        memberApi<RawBooking[]>("/gym/bookings?scope=past"),
        loadCatalog(qc),
      ]);
      return [...upcoming, ...past].map((b) => toBookingView(b, catalog));
    },
  });
}

export function useWallet() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.wallet,
    queryFn: async () => {
      const [raw, catalog] = await Promise.all([memberApi<RawWallet>("/gym/credits"), loadCatalog(qc)]);
      return toWalletView(raw, catalog);
    },
  });
}

export function usePackages() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.packages,
    queryFn: async () => {
      const [raw, catalog] = await Promise.all([
        memberApi<{ packages: RawPackage[]; ark_enabled: boolean }>("/gym/credits/packages"),
        loadCatalog(qc),
      ]);
      return { packages: raw.packages.map((p) => toPackageView(p, catalog)), arkEnabled: raw.ark_enabled };
    },
  });
}

/** Purchase status, polled while the QR is waiting to be paid. */
export const usePayment = (id: string) =>
  useQuery({
    queryKey: keys.payment(id),
    queryFn: async () => toPaymentView(await memberApi<RawPurchase>(`/gym/credits/purchases/${id}`)),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.payment.status === "pending" ? PAYMENT_POLL_MS : false),
  });

/** Everything that changes bookings/credits touches several views at once. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useBookMutation() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await memberApi<{ status: "confirmed" | "waitlist"; waitlistPosition: number | null }>(
        "/gym/bookings",
        { method: "POST", json: { session_id: sessionId } }
      );
      return {
        decision: res.status === "confirmed" ? ("CONFIRMED" as const) : ("WAITLIST" as const),
        booking: { waitlistPosition: res.waitlistPosition },
      };
    },
    onSuccess: invalidate,
  });
}

export function useCancelMutation() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await memberApi<{ late: boolean; penalty_credits: number }>(`/gym/bookings/${bookingId}`, {
        method: "DELETE",
      });
      return { outcome: res.late ? ("LATE" as const) : ("ON_TIME" as const), penaltyCredits: res.penalty_credits };
    },
    onSuccess: invalidate,
  });
}

export const confirmSpot = (bookingId: string) =>
  memberApi(`/gym/bookings/${bookingId}`, { method: "POST", json: { action: "confirm_offer" } });

export const buyPackage = (packageId: string, method: "qris" | "ark_coin") =>
  memberApi<RawPurchase>("/gym/credits/purchases", { method: "POST", json: { package_id: packageId, method } });

/** Local dev only: settle the simulated QR through the webhook path. */
export const simulatePaid = (purchaseId: string) =>
  memberApi(`/gym/credits/purchases/${purchaseId}/simulate-paid`, { method: "POST" });
