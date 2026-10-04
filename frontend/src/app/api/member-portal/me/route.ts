import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { resolveTierByXp } from "@/lib/member-portal/tier";
import {
  computeProfileCompletion,
  PROFILE_FIELD_LABELS,
  type MemberProfileFields,
} from "@/lib/member-portal/profile";
import { dateColToIso } from "@/lib/payroll/period";
import { DEFAULT_POS_LOYALTY_SETTINGS } from "@/lib/pos/loyalty-settings";
import { readMarketingConsent } from "@/lib/member-portal/consent";

/**
 * GET /api/member-portal/me — profil + saldo/XP/tier + progres tier
 * berikutnya + status kelengkapan profil & Free XP. EPIC-011 Fase D.
 */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();
    const [{ rows: customers }, { rows: tiers }, { rows: settings }] =
      await Promise.all([
        pool.query(
          `SELECT id, name, phone, email, birth_date, gender, city, photo_url,
                  wa_consent, member_type, membership_tier,
                  ark_coin_balance::float AS ark_coin_balance,
                  total_xp::float AS total_xp,
                  visit_count, free_xp_granted_at, wa_verified_at
           FROM pos.pos_customers WHERE id = $1`,
          [session.customerId]
        ),
        pool.query(
          `SELECT code, name, rank, min_lifetime_xp::float AS min_lifetime_xp,
                  discount_percent::float AS discount_percent
           FROM crm.crm_membership_tiers WHERE is_active ORDER BY rank`,
          []
        ),
        pool.query(
          `SELECT value FROM crm.crm_settings WHERE key = 'profile_completion_free_xp'`,
          []
        ),
      ]);
    // ark_coin_balance disimpan dalam Rupiah (kasir memotongnya 1:1 terhadap
    // total order), jadi portal butuh rate-nya untuk menampilkan ARK Coin.
    const { rows: loyalty } = await pool.query(
      `SELECT ark_rate::float AS ark_rate,
              COALESCE(low_balance_threshold_idr, 0)::float AS low_balance_threshold_idr
       FROM pos.pos_loyalty_settings
       WHERE is_active ORDER BY updated_at DESC LIMIT 1`,
      []
    );
    const customer = customers[0];
    if (!customer) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    const fields: MemberProfileFields = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      birth_date: dateColToIso(customer.birth_date),
      gender: customer.gender,
      city: customer.city,
      photo_url: customer.photo_url,
      wa_consent: customer.wa_consent,
    };
    const completion = computeProfileCompletion(fields);

    const totalXp = Number(customer.total_xp) || 0;
    const currentTier = resolveTierByXp(tiers, totalXp);
    const nextTier = tiers.find((tier) => Number(tier.min_lifetime_xp) > totalXp) ?? null;

    return NextResponse.json({
      success: true,
      data: {
        profile: { id: customer.id, ...fields },
        member_type: customer.member_type,
        ark_coin_balance: Number(customer.ark_coin_balance) || 0,
        ark_rate: Number(loyalty[0]?.ark_rate) || DEFAULT_POS_LOYALTY_SETTINGS.ark_rate,
        // Rupiah; 0 = peringatan saldo rendah di portal mati.
        low_balance_threshold_idr: Number(loyalty[0]?.low_balance_threshold_idr) || 0,
        marketing_opt_in: await readMarketingConsent(pool, session.customerId),
        total_xp: totalXp,
        visit_count: Number(customer.visit_count) || 0,
        tier: currentTier
          ? {
              code: currentTier.code,
              name: currentTier.name,
              discount_percent: Number(currentTier.discount_percent) || 0,
            }
          : null,
        next_tier: nextTier
          ? {
              name: nextTier.name,
              min_lifetime_xp: Number(nextTier.min_lifetime_xp),
              xp_needed: Math.max(0, Number(nextTier.min_lifetime_xp) - totalXp),
            }
          : null,
        // Tangga tier lengkap — untuk dialog progres XP di portal Nox.
        tiers: tiers.map((tier) => ({
          code: tier.code,
          name: tier.name,
          min_lifetime_xp: Number(tier.min_lifetime_xp) || 0,
          discount_percent: Number(tier.discount_percent) || 0,
        })),
        completion: {
          ...completion,
          missing_labels: completion.missing.map((key) => PROFILE_FIELD_LABELS[key]),
        },
        free_xp_granted: Boolean(customer.free_xp_granted_at),
        free_xp_amount: Number(settings[0]?.value) || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching member me:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat profil" },
      { status: 500 }
    );
  }
}
