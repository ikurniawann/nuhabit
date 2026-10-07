/**
 * Pintu masuk mesin loyalti CRM (XP & tier). Implementasi per tanggung jawab:
 * - loyalty-rules.ts       aturan XP/tier murni
 * - loyalty-ledger.ts      enrol profil + posting ledger XP idempoten
 * - loyalty-tier-sync.ts   sinkron pos_customers & tier
 * - loyalty-pos-earn.ts    XP order, split payment, topup, bonus produk
 * - loyalty-awards.ts      XP nominal non-order (profil, challenge, badge, partner)
 * - loyalty-corrections.ts tarik XP void & penyesuaian admin
 */
export type { CrmXpAwardResult } from "./loyalty-rules";
export { syncPosCustomerOrderStats } from "./loyalty-tier-sync";
export {
  awardCrmXpForPosOrder,
  awardCrmXpForSplitPayment,
  awardCrmXpForTopup,
} from "./loyalty-pos-earn";
export {
  awardBadgeBonusXp,
  awardChallengeXp,
  awardMemberFreeXp,
  awardPartnerEventXp,
} from "./loyalty-awards";
export { adjustMemberXp, reverseCrmXpForVoidedOrders } from "./loyalty-corrections";
