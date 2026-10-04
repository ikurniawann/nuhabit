import { formatNumber } from "@/lib/format";
import type {
  CrmAvatar,
  CrmAvatarInventory,
  CrmMember,
  CrmTier,
  UpdateMemberPayload,
} from "./types";

export type AvatarActivityTone = "emerald" | "amber" | "sky" | "slate";

export type AvatarActivity = {
  id: string;
  title: string;
  detail: string;
  date: string;
  tone: AvatarActivityTone;
};

export type GrantSource = "manual" | "campaign" | "partner";

export type MemberEditForm = {
  name: string;
  phone: string;
  email: string;
  tierId: string;
  status: string;
  customerActive: boolean;
  /** EPIC-043 — KOL: komplimen gratis otomatis di kasir + kuota bulanan. */
  isKol: boolean;
  kolLimit: string;
};

const SOURCE_LABELS: Record<string, string> = {
  redemption: "XP redemption",
  manual: "Manual grant",
  campaign: "Campaign grant",
  partner: "Partner grant",
  migration: "Migration",
};

const SOURCE_TONES: Record<string, AvatarActivityTone> = {
  redemption: "emerald",
  campaign: "amber",
  partner: "sky",
};

export function tierName(member: CrmMember): string {
  return member.tier?.name || member.customer?.membership_tier || "Regular";
}

export function avatarSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Profil CRM "pos-…" adalah customer POS yang belum di-enroll. */
export function isCrmProfileReady(member: CrmMember): boolean {
  return !member.id.startsWith("pos-");
}

export function activeTiersOf(tiers: CrmTier[]): CrmTier[] {
  return tiers.filter((tier) => tier.is_active !== false);
}

export function findActiveAvatar(
  member: CrmMember,
  inventory: CrmAvatarInventory[]
): CrmAvatarInventory | null {
  return (
    inventory.find((item) => item.is_equipped) ??
    inventory.find((item) => item.avatar_id === member.active_avatar_id) ??
    null
  );
}

/** Avatar aktif yang belum dimiliki member, urut nama. */
export function grantableAvatars(avatars: CrmAvatar[], inventory: CrmAvatarInventory[]): CrmAvatar[] {
  const owned = new Set(inventory.map((item) => item.avatar_id));
  return avatars
    .filter((avatar) => avatar.is_active && !owned.has(avatar.id))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** Sisa stok avatar; null = tanpa batas. */
export function avatarStockLeft(avatar: CrmAvatar | null): number | null {
  if (avatar?.stock_total === null || avatar?.stock_total === undefined) return null;
  return Math.max(0, avatar.stock_total - avatar.stock_redeemed);
}

/** Riwayat avatar: perolehan + avatar aktif, terbaru dulu, maks 12. */
export function buildAvatarActivity(inventory: CrmAvatarInventory[]): AvatarActivity[] {
  const acquired = inventory.map((item): AvatarActivity => {
    const xpCost = item.metadata?.xp_cost ? ` · ${formatNumber(item.metadata.xp_cost)} XP` : "";
    const note = item.metadata?.note ? ` · ${item.metadata.note}` : "";
    return {
      id: `acquired-${item.id}`,
      title: `${avatarSourceLabel(item.acquisition_source)}: ${item.avatar?.name || "Avatar"}`,
      detail: `${item.avatar?.rarity || "collectible"}${xpCost}${note}`,
      date: item.acquired_at,
      tone: SOURCE_TONES[item.acquisition_source] ?? "slate",
    };
  });

  const active = inventory
    .filter((item) => item.is_equipped)
    .map((item): AvatarActivity => ({
      id: `active-${item.id}`,
      title: `Active avatar: ${item.avatar?.name || "Avatar"}`,
      detail: "Avatar yang sedang dipakai member",
      date: item.acquired_at,
      tone: "sky",
    }));

  return [...active, ...acquired]
    .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
    .slice(0, 12);
}

/** XP yang masih kurang ke ambang tier saat ini (0 bila sudah lewat). */
export function xpToTierRule(member: CrmMember): number {
  const min = member.tier?.min_lifetime_xp;
  return min ? Math.max(0, min - member.lifetime_xp) : 0;
}

export function editFormFromMember(member: CrmMember, activeTiers: CrmTier[]): MemberEditForm {
  const customer = member.customer;
  return {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    tierId: activeTiers.find((tier) => tier.code === member.tier?.code)?.id ?? "",
    status: member.status || "active",
    customerActive: customer?.is_active !== false,
    isKol: customer?.is_kol === true,
    kolLimit: customer?.kol_monthly_limit_idr != null ? String(customer.kol_monthly_limit_idr) : "",
  };
}

export function toUpdateMemberPayload(form: MemberEditForm, crmProfileReady: boolean): UpdateMemberPayload {
  return {
    customer: {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      is_active: form.customerActive,
      is_kol: form.isKol,
      kol_monthly_limit_idr: form.isKol && form.kolLimit.trim() !== "" ? Number(form.kolLimit) : null,
    },
    member: crmProfileReady ? { tier_id: form.tierId || undefined, status: form.status } : undefined,
  };
}
