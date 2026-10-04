// Hadiah XP nominal non-order (profil, challenge, badge, partner) — semua lewat awardFlatXp.
import type { DbClient } from "@/lib/pg/types";
import { awardFlatXp } from "./loyalty-ledger";
import type { CrmXpAwardResult } from "./loyalty-rules";

type Venue = { companyId?: string | null; branchId?: string | null };

/**
 * Free XP kelengkapan profil 100% (EPIC-011 Fase D, keputusan owner #9):
 * berlaku SEMUA tipe member, sekali seumur hidup, TANPA multiplier tier
 * (nominal apa adanya dari crm_settings.profile_completion_free_xp).
 * Idempoten dua lapis: idempotency_key ledger + free_xp_granted_at customer.
 */
export function awardMemberFreeXp(
  db: DbClient,
  input: Venue & { customerId: string; xpAmount: number }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    ...input,
    sourceType: "profile_completion",
    sourceId: input.customerId,
    referenceTable: "pos_customers",
    idempotencyKey: `portal:profile-complete:${input.customerId}`,
    description: "Free XP profil lengkap (portal member)",
  });
}

/** Hadiah XP challenge selesai — sekali per member per challenge. */
export function awardChallengeXp(
  db: DbClient,
  input: Venue & { customerId: string; challengeId: string; challengeTitle: string; xpAmount: number }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceType: "challenge",
    sourceId: input.challengeId,
    referenceTable: "challenges",
    idempotencyKey: `challenge:${input.challengeId}:${input.customerId}`,
    description: `Hadiah challenge: ${input.challengeTitle}`,
  });
}

/** Bonus XP badge — sekali per member per badge (idempotency key ledger). */
export function awardBadgeBonusXp(
  db: DbClient,
  input: Venue & { customerId: string; badgeId: string; badgeName: string; xpAmount: number }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceType: "badge_bonus",
    sourceId: input.badgeId,
    referenceTable: "crm_badges",
    idempotencyKey: `badge:${input.badgeId}:${input.customerId}`,
    description: `Bonus badge: ${input.badgeName}`,
  });
}

/** XP dari event partner loyalty — sekali per event (idempotency key ledger). */
export function awardPartnerEventXp(
  db: DbClient,
  input: Venue & {
    customerId: string;
    eventId: string;
    sourceChannel: string;
    description: string;
    xpAmount: number;
  }
): Promise<CrmXpAwardResult> {
  return awardFlatXp(db, {
    customerId: input.customerId,
    xpAmount: input.xpAmount,
    companyId: input.companyId,
    branchId: input.branchId,
    sourceChannel: input.sourceChannel,
    sourceType: "partner_event",
    sourceId: input.eventId,
    referenceTable: "crm_external_events",
    idempotencyKey: `partner-event:${input.eventId}`,
    description: input.description,
  });
}
