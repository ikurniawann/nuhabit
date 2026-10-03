import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";

/** Baca detail member: Customer Care atau Loyalty. */
export const MEMBER_READ_MENUS = [...IAM.crmMembers, ...IAM.crmLoyalty];
/** Ubah XP & badge member: Loyalty atau Pengaturan CRM. */
export const MEMBER_LOYALTY_WRITE_MENUS = [...IAM.crmLoyalty, ...IAM.crmSettings];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id di URL detail member bisa berupa id profil CRM, id customer POS, atau
 * "pos-<customerId>" (customer belum punya profil). Kembalikan id customer.
 */
export async function resolveCustomerId(idParam: string): Promise<string | null> {
  const id = idParam.startsWith("pos-") ? idParam.slice(4) : idParam;
  if (!UUID.test(id)) return null;
  const { rows } = await getPool().query<{ customer_id: string }>(
    `SELECT customer_id FROM crm.crm_member_profiles WHERE id = $1 OR customer_id = $1
     UNION ALL
     SELECT id FROM pos.pos_customers WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0]?.customer_id ?? null;
}

export const MEMBER_ACTIVITY_TABS = ["checkins", "bookings", "challenges", "notifications", "wallet"] as const;
export type MemberActivityTab = (typeof MEMBER_ACTIVITY_TABS)[number];

const ACTIVITY_SQL: Record<MemberActivityTab, string> = {
  checkins: `SELECT k.id, k.decision, k.reason, k.created_at, u.full_name AS cashier_name
               FROM crm.member_checkins k
               LEFT JOIN configuration.users u ON u.id = k.scanned_by
              WHERE k.customer_id = $1 ORDER BY k.created_at DESC LIMIT 100`,
  bookings: `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
                    e.id AS event_id, e.title, e.starts_at, e.location, e.price_idr::float AS price_idr
               FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
              WHERE b.customer_id = $1 ORDER BY e.starts_at DESC LIMIT 100`,
  challenges: `SELECT c.id, c.title, c.metric, c.target::float AS target, c.starts_at, c.ends_at,
                      c.reward_xp, c.reward_ark_idr::float AS reward_ark_idr, j.joined_at, j.rewarded_at
                 FROM crm.challenge_joins j JOIN crm.challenges c ON c.id = j.challenge_id
                WHERE j.customer_id = $1 ORDER BY j.joined_at DESC LIMIT 100`,
  notifications: `SELECT n.id, n.type, n.title, n.body, n.created_at, n.read_at, n.opened_at, n.clicked_at,
                         k.name AS campaign_name
                    FROM crm.member_notifications n
                    LEFT JOIN crm.crm_campaigns k ON k.id = n.campaign_id
                   WHERE n.customer_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
  wallet: `SELECT w.id, w.type, w.amount::float AS amount, w.ark_coins::float AS ark_coins,
                  w.balance_after::float AS balance_after, w.status, w.notes, w.payment_method, w.created_at
             FROM pos.pos_wallet_transactions w
            WHERE w.customer_id = $1 ORDER BY w.created_at DESC LIMIT 100`,
};

export async function loadMemberActivity(customerId: string, tab: MemberActivityTab): Promise<unknown[]> {
  const { rows } = await getPool().query(ACTIVITY_SQL[tab], [customerId]);
  return rows;
}
