import { getPool } from "@/lib/db";
import { selectMemberPromos, type MemberPromoRow } from "@/lib/member-portal/promos";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";
import { todayWib } from "@/lib/pos/report-dates";

/** GET — promo yang ditandai tampil di portal, beserta satu kode publik per campaign. */
export const GET = withMemberSession("Gagal memuat promo", async (customerId) => {
  const { rows } = await getPool().query<MemberPromoRow>(
    `SELECT c.id AS campaign_id, c.name, c.description, c.discount_type,
            c.value::float AS value, c.max_discount::float AS max_discount,
            c.min_purchase::float AS min_purchase,
            c.valid_from::text AS valid_from, c.valid_until::text AS valid_until,
            c.usage_limit, c.per_phone_limit, c.scope, c.is_active, c.show_in_member_portal,
            k.code, k.is_active AS code_is_active, k.usage_limit AS code_usage_limit,
            k.usage_count AS code_usage_count,
            (SELECT count(*)::int FROM promo.promo_redemptions r
              WHERE r.campaign_id = c.id AND r.status IN ('held', 'captured')) AS campaign_used_count,
            (SELECT count(*)::int FROM promo.promo_redemptions r
              JOIN pos.pos_customers m ON m.id = $1
              WHERE r.campaign_id = c.id AND r.status IN ('held', 'captured')
                AND (r.customer_id = m.id
                     OR regexp_replace(COALESCE(r.phone, ''), '\\D', '', 'g')
                        = regexp_replace(m.phone, '\\D', '', 'g'))) AS my_used_count
       FROM promo.promo_campaigns c
       JOIN promo.promo_codes k ON k.campaign_id = c.id
      WHERE c.show_in_member_portal AND c.is_active AND k.is_active
      ORDER BY c.valid_until NULLS LAST, c.created_at DESC, k.created_at`,
    [customerId]
  );
  return memberJson(selectMemberPromos(rows, todayWib()));
});
