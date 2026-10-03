/**
 * Adapters from this repo's gym member APIs (/api/member-portal/gym/*) to the
 * shapes the reference member app screens read (@nuhabit/api-client views),
 * so the ported screens stay close to the reference markup.
 */

/* ── Raw API shapes ──────────────────────────────────────────────────── */

export interface RawMyBooking {
  id: string;
  status: string;
  waitlist_position: number | null;
  promotion_offered_at: string | null;
}

export interface RawSession {
  id: string;
  class_type_id: string;
  class_type_name: string;
  coach_id: string | null;
  coach_name: string | null;
  branch_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  credit_cost: number;
  status: string;
  confirmed_count: number;
  waitlist_count: number;
  seats_left: number;
  my_booking: RawMyBooking | null;
}

export interface RawCoach {
  id: string;
  name: string;
  bio: string | null;
  specialization: string | null;
}

export interface RawBooking {
  id: string;
  status: string;
  promotion_offered_at: string | null;
  session_id: string;
  branch_id: string | null;
  starts_at: string;
  class_type_name: string;
}

export interface RawCatalog {
  branches: { id: string; name: string }[];
  class_types: {
    id: string;
    name: string;
    description: string | null;
    default_duration_min: number;
    default_credit_cost: number;
  }[];
  packages: { id: string; class_type_ids: string[] | null }[];
  coaches: { id: string; branch_id: string | null }[];
}

export interface RawLot {
  id: string;
  package_id: string | null;
  package_name: string | null;
  credits: number;
  remaining: number;
  expires_at: string;
  created_at: string;
  expired: boolean;
}

export interface RawWallet {
  balance: number;
  expiring_credits: number;
  lots: RawLot[];
  entries: { id: string; type: string; amount: number; note: string | null; created_at: string }[];
}

export interface RawPackage {
  id: string;
  name: string;
  credits: number;
  price_idr: number;
  validity_days: number;
  can_buy: boolean;
  blocked_reason: string | null;
}

export interface RawPurchase {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';
  package_name: string;
  credits: number;
  total_idr: number;
  payment_method: string;
  qr_string: string | null;
  expires_at: string | null;
  simulated: boolean;
}

/* ── Reference-shaped views ──────────────────────────────────────────── */

export interface MyBookingView {
  id: string;
  status: string;
  waitlistPosition: number | null;
  promotionOfferedAt: string | null;
}

export interface SessionView {
  session: {
    id: string;
    classTypeId: string;
    branchId: string | null;
    coachId: string | null;
    startsAt: string;
    endsAt: string;
    status: string;
    creditCost: number;
    capacity: number;
  };
  classTypeName: string;
  branchName: string;
  coachName: string;
  spotsLeft: number;
  confirmedCount: number;
  waitlistCount: number;
  myBooking: MyBookingView | null;
}

export interface TrainerView {
  coach: { id: string; name: string; specialization: string; bio: string };
  branchName: string;
  upcomingCount: number;
  classTypeNames: string[];
}

export interface BookingView {
  booking: { id: string; status: string; promotionOfferedAt: string | null };
  session: { id: string; startsAt: string };
  classTypeName: string;
  branchName: string;
}

export interface MyPackageView {
  lotId: string;
  name: string;
  credits: number;
  purchasedAt: string;
  expiresAt: string;
  active: boolean;
  coverageIds: string[] | null;
  coverageNames: string[] | null;
}

export interface WalletView {
  balance: number;
  expiringCredits: number;
  myPackages: MyPackageView[];
  entries: { id: string; type: string; amount: number; description: string | null; createdAt: string }[];
}

export interface PackageView {
  id: string;
  name: string;
  credits: number;
  priceIdr: number;
  validityDays: number;
  coverageNames: string[] | null;
  canBuy: boolean;
  blockedReason: string | null;
}

export interface PaymentView {
  payment: {
    id: string;
    channel: 'QRIS' | 'ARK_COIN';
    status: RawPurchase['status'];
    credits: number;
    totalIdr: number;
    qrString: string | null;
    expiresAt: string | null;
    simulated: boolean;
  };
  packageName: string;
}

/* ── Mapping ─────────────────────────────────────────────────────────── */

const upper = (status: string) => status.toUpperCase();

/** Branch name by id; a session/coach without a branch belongs to the only branch, if there is one. */
export function branchNameOf(catalog: RawCatalog | undefined, branchId: string | null): string {
  const branches = catalog?.branches ?? [];
  if (branchId) return branches.find((b) => b.id === branchId)?.name ?? '';
  return branches.length === 1 ? branches[0]!.name : '';
}

/** Sessions without a branch run for every branch (same rule as listSessions). */
export const inBranch = (branchId: string | null, filter: string | undefined) =>
  !filter || branchId === null || branchId === filter;

export function toSessionView(raw: RawSession, catalog: RawCatalog | undefined): SessionView {
  const mine = raw.my_booking;
  return {
    session: {
      id: raw.id,
      classTypeId: raw.class_type_id,
      branchId: raw.branch_id,
      coachId: raw.coach_id,
      startsAt: raw.starts_at,
      endsAt: raw.ends_at,
      status: upper(raw.status),
      creditCost: raw.credit_cost,
      capacity: raw.capacity,
    },
    classTypeName: raw.class_type_name,
    branchName: branchNameOf(catalog, raw.branch_id),
    coachName: raw.coach_name ?? '',
    spotsLeft: raw.seats_left,
    confirmedCount: raw.confirmed_count,
    waitlistCount: raw.waitlist_count,
    myBooking: mine
      ? {
          id: mine.id,
          status: upper(mine.status),
          waitlistPosition: mine.waitlist_position,
          promotionOfferedAt: mine.promotion_offered_at,
        }
      : null,
  };
}

/**
 * Coaches with what each has coming up in the given sessions. Every active
 * coach stays on the list (reference behaviour); with a branch filter, only
 * coaches based there, unassigned, or teaching there appear.
 */
export function toTrainerViews(
  coaches: RawCoach[],
  sessions: SessionView[],
  catalog: RawCatalog | undefined,
  branchId?: string,
): TrainerView[] {
  const coachBranch = new Map((catalog?.coaches ?? []).map((c) => [c.id, c.branch_id]));
  return coaches
    .map((coach) => {
      const own = sessions.filter(
        (v) => v.session.coachId === coach.id && inBranch(v.session.branchId, branchId),
      );
      const home = coachBranch.get(coach.id) ?? own.find((v) => v.session.branchId)?.session.branchId ?? null;
      return {
        view: {
          coach: {
            id: coach.id,
            name: coach.name,
            specialization: coach.specialization ?? '',
            bio: coach.bio ?? '',
          },
          branchName: branchNameOf(catalog, home),
          upcomingCount: own.length,
          classTypeNames: [...new Set(own.map((v) => v.classTypeName))],
        },
        home,
      };
    })
    .filter(({ view, home }) => !branchId || view.upcomingCount > 0 || home === null || home === branchId)
    .map(({ view }) => view);
}

export function toBookingView(raw: RawBooking, catalog: RawCatalog | undefined): BookingView {
  return {
    booking: { id: raw.id, status: upper(raw.status), promotionOfferedAt: raw.promotion_offered_at },
    session: { id: raw.session_id, startsAt: raw.starts_at },
    classTypeName: raw.class_type_name,
    branchName: branchNameOf(catalog, raw.branch_id),
  };
}

/** Class type ids a package covers; null = every class. */
function coverageOf(catalog: RawCatalog | undefined, packageId: string | null): string[] | null {
  if (!packageId) return null;
  const ids = catalog?.packages.find((p) => p.id === packageId)?.class_type_ids;
  return Array.isArray(ids) ? ids : null;
}

function coverageNamesOf(catalog: RawCatalog | undefined, ids: string[] | null): string[] | null {
  if (!ids) return null;
  const names = new Map((catalog?.class_types ?? []).map((c) => [c.id, c.name]));
  return ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
}

export function toWalletView(raw: RawWallet, catalog: RawCatalog | undefined): WalletView {
  return {
    balance: raw.balance,
    expiringCredits: raw.expiring_credits,
    myPackages: raw.lots.map((lot) => {
      const coverageIds = coverageOf(catalog, lot.package_id);
      return {
        lotId: lot.id,
        name: lot.package_name ?? 'Bonus credits',
        credits: lot.credits,
        purchasedAt: lot.created_at,
        expiresAt: lot.expires_at,
        active: !lot.expired && lot.remaining > 0,
        coverageIds,
        coverageNames: coverageNamesOf(catalog, coverageIds),
      };
    }),
    entries: raw.entries.map((e) => ({
      id: e.id,
      type: upper(e.type),
      amount: e.amount,
      description: e.note,
      createdAt: e.created_at,
    })),
  };
}

export function toPackageView(raw: RawPackage, catalog: RawCatalog | undefined): PackageView {
  return {
    id: raw.id,
    name: raw.name,
    credits: raw.credits,
    priceIdr: raw.price_idr,
    validityDays: raw.validity_days,
    coverageNames: coverageNamesOf(catalog, coverageOf(catalog, raw.id)),
    canBuy: raw.can_buy,
    blockedReason: raw.blocked_reason,
  };
}

export function toPaymentView(raw: RawPurchase): PaymentView {
  return {
    payment: {
      id: raw.id,
      channel: raw.payment_method === 'ark_coin' ? 'ARK_COIN' : 'QRIS',
      status: raw.status,
      credits: raw.credits,
      totalIdr: raw.total_idr,
      qrString: raw.qr_string,
      expiresAt: raw.expires_at,
      simulated: raw.simulated,
    },
    packageName: raw.package_name,
  };
}

/** Packages that are still usable. */
export const activePackages = (wallet: WalletView | undefined) => (wallet?.myPackages ?? []).filter((p) => p.active);

/**
 * Package coverage indicator for a class type: null = no package credits (no
 * restriction shown), true/false = whether any active package covers it.
 */
export function coverageFor(wallet: WalletView | undefined, classTypeId: string): boolean | null {
  const active = activePackages(wallet);
  if (active.length === 0) return null;
  return active.some((p) => p.coverageIds === null || p.coverageIds.includes(classTypeId));
}

/** "Name · Other" without dangling separators when a part is missing. */
export const joinDot = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
