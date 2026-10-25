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
  /** Branch zone (IANA) the session times read in. */
  timezone?: string;
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
  timezone?: string;
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

/** credits: a batch of class credits; pass: unlimited bookings for validity_days. */
export type PackageKind = 'credits' | 'pass';

export type RenewWith = 'ark' | 'invoice' | 'saved_method';

export interface RawPass {
  id: string;
  package_id: string;
  package_name: string;
  starts_at: string;
  ends_at: string;
  status: 'active' | 'frozen' | 'expired' | 'refunded';
  /** Active but queued behind the pass that runs now. */
  upcoming?: boolean;
  days_left: number;
  frozen_until?: string | null;
  auto_renew?: boolean;
  renew_with?: RenewWith;
  /** "renewal_failed" once the renewal retries ran out. */
  auto_renew_off_reason?: string | null;
}

/** Freeze budget over the last 365 days. */
export interface FreezeAllowance {
  max_days_per_year: number;
  min_days: number;
  used_days: number;
  remaining_days: number;
}

export interface RawWallet {
  balance: number;
  expiring_credits: number;
  lots: RawLot[];
  passes: RawPass[];
  freeze?: FreezeAllowance;
  transfer?: { member_enabled: boolean; monthly_cap: number; sent_this_month: number };
  entries: { id: string; type: string; amount: number; note: string | null; created_at: string }[];
}

export interface RawPackage {
  id: string;
  name: string;
  kind: PackageKind;
  credits: number;
  price_idr: number;
  validity_days: number;
  badge: string | null;
  /** Pass: also pays for personal training sessions. */
  covers_personal?: boolean;
  can_buy: boolean;
  blocked_reason: string | null;
}

export interface RawPurchase {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';
  package_name: string;
  kind: PackageKind;
  credits: number;
  validity_days: number;
  total_idr: number;
  payment_method: string;
  /** Provider the payment runs at (xendit, midtrans) or dev_simulated. */
  gateway?: string;
  qr_string: string | null;
  /** Rendered QR PNG when the gateway serves one (Midtrans). */
  qr_image_url?: string | null;
  invoice_url: string | null;
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
    timezone?: string;
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
  session: { id: string; startsAt: string; timezone?: string };
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

export interface PassView {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: RawPass['status'];
  upcoming: boolean;
  daysLeft: number;
  frozenUntil: string | null;
  autoRenew: boolean;
  renewWith: RenewWith;
  autoRenewOffReason: string | null;
}

export interface WalletView {
  balance: number;
  expiringCredits: number;
  /** The pass covering today, if any. */
  activePass: PassView | null;
  /** The membership the member holds now: the running pass, or a frozen one. */
  membership: PassView | null;
  /** Passes bought ahead that start when the current one ends. */
  queuedPasses: PassView[];
  freeze: FreezeAllowance | null;
  passes: PassView[];
  myPackages: MyPackageView[];
  /** Sending credits to another member: allowed by the gym rules, and how much is left this month (null = no cap). */
  transfer: { enabled: boolean; leftThisMonth: number | null };
  entries: { id: string; type: string; amount: number; description: string | null; createdAt: string }[];
}

export interface PackageView {
  id: string;
  name: string;
  kind: PackageKind;
  credits: number;
  priceIdr: number;
  validityDays: number;
  badge: string | null;
  coverageNames: string[] | null;
  /** Pass: PT sessions are covered too. */
  coversPersonal: boolean;
  canBuy: boolean;
  blockedReason: string | null;
}

export interface PaymentView {
  payment: {
    id: string;
    channel: 'QRIS' | 'ARK_COIN' | 'INVOICE' | 'SAVED_METHOD';
    status: RawPurchase['status'];
    kind: PackageKind;
    credits: number;
    validityDays: number;
    totalIdr: number;
    gateway: string;
    qrString: string | null;
    qrImageUrl: string | null;
    invoiceUrl: string | null;
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
      timezone: raw.timezone,
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
    session: { id: raw.session_id, startsAt: raw.starts_at, timezone: raw.timezone },
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

const toPassView = (p: RawPass): PassView => ({
  id: p.id,
  name: p.package_name,
  startsAt: p.starts_at,
  endsAt: p.ends_at,
  status: p.status,
  upcoming: p.upcoming ?? false,
  daysLeft: p.days_left,
  frozenUntil: p.frozen_until ?? null,
  autoRenew: p.auto_renew ?? false,
  renewWith: p.renew_with ?? 'invoice',
  autoRenewOffReason: p.auto_renew_off_reason ?? null,
});

export function toWalletView(raw: RawWallet, catalog: RawCatalog | undefined): WalletView {
  const passes = (raw.passes ?? []).map(toPassView);
  const activePass = passes.find((p) => p.status === 'active' && !p.upcoming) ?? null;
  return {
    balance: raw.balance,
    expiringCredits: raw.expiring_credits,
    activePass,
    membership: activePass ?? passes.find((p) => p.status === 'frozen') ?? null,
    queuedPasses: passes.filter((p) => p.status === 'active' && p.upcoming),
    freeze: raw.freeze ?? null,
    passes,
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
    transfer: {
      enabled: raw.transfer?.member_enabled ?? false,
      leftThisMonth: raw.transfer?.monthly_cap ? Math.max(0, raw.transfer.monthly_cap - raw.transfer.sent_this_month) : null,
    },
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
    kind: raw.kind ?? 'credits',
    credits: raw.credits,
    priceIdr: raw.price_idr,
    validityDays: raw.validity_days,
    badge: raw.badge ?? null,
    coverageNames: raw.kind === 'pass' ? null : coverageNamesOf(catalog, coverageOf(catalog, raw.id)),
    coversPersonal: raw.kind === 'pass' && raw.covers_personal === true,
    canBuy: raw.can_buy,
    blockedReason: raw.blocked_reason,
  };
}

const CHANNELS: Record<string, PaymentView['payment']['channel']> = {
  ark_coin: 'ARK_COIN',
  invoice: 'INVOICE',
  saved_method: 'SAVED_METHOD',
};

export function toPaymentView(raw: RawPurchase): PaymentView {
  return {
    payment: {
      id: raw.id,
      channel: CHANNELS[raw.payment_method] ?? 'QRIS',
      status: raw.status,
      kind: raw.kind ?? 'credits',
      credits: raw.credits,
      validityDays: raw.validity_days,
      totalIdr: raw.total_idr,
      gateway: raw.gateway ?? 'xendit',
      qrString: raw.qr_string,
      qrImageUrl: raw.qr_image_url ?? null,
      invoiceUrl: raw.invoice_url ?? null,
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
 * restriction shown), true/false = whether any active package covers it. An
 * active pass covers every class.
 */
export function coverageFor(wallet: WalletView | undefined, classTypeId: string): boolean | null {
  if (wallet?.activePass) return true;
  const active = activePackages(wallet);
  if (active.length === 0) return null;
  return active.some((p) => p.coverageIds === null || p.coverageIds.includes(classTypeId));
}

/** "Name · Other" without dangling separators when a part is missing. */
export const joinDot = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/** A card or e-wallet the member saved at Xendit for auto-renew. Only a masked label is known. */
export interface SavedMethod {
  id: string;
  status: 'pending' | 'active';
  type: 'card' | 'ewallet' | 'other' | null;
  channel: string | null;
  label: string | null;
  simulated: boolean;
  linked_at: string | null;
  created_at: string;
}

/** The payment methods screen: enabled is false while the feature is off. */
export interface SavedMethods {
  enabled: boolean;
  methods: SavedMethod[];
}

/** The member's method renewals can charge, if any. */
export const activeMethod = (s: SavedMethods | undefined): SavedMethod | null =>
  s?.methods.find((m) => m.status === 'active') ?? null;
