import { getLoyaltyFeatures } from "@/lib/crm/loyalty-features-server";
import { getPool } from "@/lib/db";
import { checkPackagePurchase, PURCHASE_PROBLEM_MESSAGES } from "@/lib/gym/credits";
import { countLivePurchases } from "@/lib/gym/credit-purchases-server";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";
import { canSimulateTopup } from "@/lib/wallet/member-topup";
import { loadWalletSettings } from "@/lib/wallet/server";

/**
 * GET — paket kredit yang dijual, masing-masing dengan status bisa-dibeli
 * (batas per member), plus saldo ARK Coin untuk opsi bayar pakai saldo.
 */
export const GET = withMemberSession("Gagal memuat paket kredit", async (customerId) => {
  const pool = getPool();
  const [packages, member, counts, features, settings] = await Promise.all([
    pool.query(
      `SELECT id, name, description, credits, price_idr::float AS price_idr, validity_days,
              purchase_limit_per_member, applicable_class_type_ids, branch_id, status
         FROM gym.credit_packages WHERE status = 'active' ORDER BY sort_order, price_idr`
    ),
    pool.query(
      `SELECT COALESCE(is_active, true) AS is_active, COALESCE(ark_coin_balance, 0)::float AS ark_balance_idr
         FROM pos.pos_customers WHERE id = $1`,
      [customerId]
    ),
    countLivePurchases(pool, customerId),
    getLoyaltyFeatures(),
    loadWalletSettings(pool),
  ]);
  const memberActive = member.rows[0]?.is_active ?? false;
  return memberJson({
    packages: packages.rows.map((p) => {
      const problem = checkPackagePurchase({
        pkg: { id: p.id, status: p.status, purchaseLimitPerMember: p.purchase_limit_per_member, branchId: p.branch_id },
        purchaseCount: counts.get(p.id) ?? 0,
        memberActive,
      });
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        credits: p.credits,
        price_idr: p.price_idr,
        validity_days: p.validity_days,
        purchase_limit_per_member: p.purchase_limit_per_member,
        restricted: Array.isArray(p.applicable_class_type_ids),
        can_buy: problem === null,
        blocked_reason: problem ? PURCHASE_PROBLEM_MESSAGES[problem] : null,
      };
    }),
    ark_enabled: features.arkCoin,
    ark_balance_idr: Number(member.rows[0]?.ark_balance_idr ?? 0),
    ark_rate: settings.ark_rate,
    can_simulate: canSimulateTopup(),
  });
});
