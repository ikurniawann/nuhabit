import { getPool } from "@/lib/db";
import { normalizeWaPhone } from "@/lib/pos/receipt-wa";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * WA langsung ke satu staf (coach, PIC) — EPIC-067. Dedup lewat
 * configuration.wa_notif_log (klaim sebelum kirim; gagal jelas → klaim
 * dilepas supaya bisa dicoba lagi). Tanpa jam tenang: pemanggil yang memutuskan.
 */
export async function sendStaffWa(notifType: string, dedupKey: string, phone: string | null, message: string): Promise<boolean> {
  const target = normalizeWaPhone(phone);
  if (!target) return false;
  const claim = await getPool().query<{ id: string }>(
    `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
     VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (notif_type, dedup_key) DO NOTHING RETURNING id`,
    [notifType, dedupKey.slice(0, 160), message, JSON.stringify([target])]
  );
  if (claim.rows.length === 0) return false;
  const result = await sendWhatsAppText({ target, message });
  if (!result.success && !result.timedOut) {
    await getPool().query(`DELETE FROM configuration.wa_notif_log WHERE id = $1`, [claim.rows[0].id]).catch(() => {});
    return false;
  }
  return true;
}
