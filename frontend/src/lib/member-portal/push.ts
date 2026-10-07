import webpush from "web-push";
import { getPool } from "@/lib/db";
import { linkForNotificationType, portalUrl } from "./links";

/**
 * Web push portal member. Kunci VAPID dari env (VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT). Tanpa kunci, semua fungsi kirim diam
 * (no-op) supaya lingkungan tanpa push tetap berjalan. Pengiriman best
 * effort: tidak pernah melempar ke pemanggil.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost" };
}

export interface PushMessage {
  title: string;
  body?: string;
  /** Tujuan portal ("events", "promo:KODE"); bila kosong diturunkan dari `type`. */
  link?: string | null;
  type?: string;
}

const TITLE_MAX = 80;
const BODY_MAX = 180;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Isi JSON yang dibaca service worker (public/member-assets/sw.js). */
export function buildPushPayload(message: PushMessage): string {
  const link = message.link ?? (message.type ? linkForNotificationType(message.type) : null);
  return JSON.stringify({
    title: clip(message.title.trim() || "NüHabit", TITLE_MAX),
    body: clip((message.body ?? "").trim(), BODY_MAX),
    url: portalUrl(link),
    tag: message.type ?? "member",
  });
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function deliver(rows: SubscriptionRow[], payload: string, config: VapidConfig): Promise<number> {
  const pool = getPool();
  let sent = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
          vapidDetails: config,
          TTL: 60 * 60 * 24,
        });
        sent += 1;
        await pool.query(`UPDATE crm.member_push_subscriptions SET last_sent_at = now() WHERE id = $1`, [row.id]);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 = langganan sudah dicabut di perangkat; buang supaya tidak dicoba lagi.
        if (status === 404 || status === 410) {
          await pool.query(`DELETE FROM crm.member_push_subscriptions WHERE id = $1`, [row.id]);
        } else {
          console.warn("[member-push] kirim gagal:", status ?? error);
        }
      }
    })
  );
  return sent;
}

/** Push ke semua perangkat satu member. Tidak pernah melempar. */
export async function sendMemberPush(customerId: string, message: PushMessage): Promise<number> {
  const config = vapidConfig();
  if (!config) return 0;
  try {
    const { rows } = await getPool().query<SubscriptionRow>(
      `SELECT id, endpoint, p256dh, auth FROM crm.member_push_subscriptions WHERE customer_id = $1`,
      [customerId]
    );
    return rows.length ? await deliver(rows, buildPushPayload(message), config) : 0;
  } catch (error) {
    console.warn("[member-push] gagal:", error);
    return 0;
  }
}

/** Push satu pengumuman ke penerimanya yang berlangganan. Tidak pernah melempar. */
export async function sendAnnouncementPush(announcementId: string, message: PushMessage): Promise<number> {
  const config = vapidConfig();
  if (!config) return 0;
  try {
    const { rows } = await getPool().query<SubscriptionRow>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
         FROM crm.member_push_subscriptions s
        WHERE s.customer_id IN (SELECT customer_id FROM crm.member_notifications WHERE announcement_id = $1)`,
      [announcementId]
    );
    return rows.length ? await deliver(rows, buildPushPayload(message), config) : 0;
  } catch (error) {
    console.warn("[member-push] pengumuman gagal:", error);
    return 0;
  }
}
