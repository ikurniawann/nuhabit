/**
 * EPIC-012 Fase D — pengawas SLA respons pertama.
 *
 * Menandai percakapan yang melewati batas waktu balas dan mencatat eskalasi
 * satu kali (escalated_at). EPIC-067 T-067-B3: penandaan baru kini juga
 * dikabarkan ke penerima Notifikasi WA owner (jenis "slaInbox", bisa
 * dimatikan) sebagai SATU pesan ringkasan per pengecekan — bukan per
 * percakapan — supaya aktivitas nomor bisnis tetap rendah (risiko blokir).
 * Tidak pernah mengirim apa pun ke customer.
 */

import { getPool } from "@/lib/db";
import { buildSlaInboxMessage } from "@/lib/wa/notifications-messages";
import { sendOwnerNotification } from "@/lib/wa/notifications-sender";
import { getCsSettings } from "./cs-server";

const CHECK_INTERVAL_MS = 60_000;

export async function checkSlaBreaches(): Promise<{ breached: number }> {
  const pool = getPool();
  const settings = await getCsSettings(pool);

  const { rows } = await pool.query(
    `UPDATE crm.wa_conversations
        SET sla_response_breached = true,
            escalated_at = COALESCE(escalated_at, now())
      WHERE awaiting_since IS NOT NULL
        AND status <> 'resolved'
        AND sla_response_breached = false
        AND now() - awaiting_since > ($1 || ' minutes')::interval
      RETURNING id, phone, display_name,
                floor(extract(epoch FROM now() - awaiting_since) / 60)::int AS waited_minutes`,
    [Math.max(1, settings.slaResponseMinutes)]
  );

  if (rows.length > 0) {
    console.warn(
      `[cs-sla] ${rows.length} percakapan melewati SLA respons ` +
        `${settings.slaResponseMinutes} menit: ${rows.map((r) => r.phone).join(", ")}`
    );
    // Setiap percakapan hanya ditandai sekali → kunci dari id pertama + jumlah unik per batch.
    await sendOwnerNotification({
      type: "slaInbox",
      dedupKey: `sla-inbox:${rows[0].id}:${rows.length}`,
      message: buildSlaInboxMessage(
        rows.map((r) => ({ name: r.display_name, phone: r.phone, waitedMinutes: r.waited_minutes })),
        settings.slaResponseMinutes
      ),
    }).catch((error) => console.error("[cs-sla] notifikasi WA gagal:", error));
  }

  return { breached: rows.length };
}

let started = false;

/** Daftarkan pengecekan berkala — sekali per proses server. */
export function startCsSlaWatcher(): void {
  if (started) return;
  started = true;

  const tick = () => {
    checkSlaBreaches().catch((error) => {
      console.error("[cs-sla] gagal:", error);
    });
  };
  // Delay kecil saat boot agar pool siap, lalu tiap menit.
  setTimeout(tick, 20_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
