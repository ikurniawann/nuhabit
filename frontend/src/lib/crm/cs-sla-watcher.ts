/**
 * EPIC-012 Fase D — pengawas SLA respons pertama.
 *
 * Menandai percakapan yang melewati batas waktu balas dan mencatat eskalasi
 * satu kali (escalated_at). Sengaja hanya menandai di DB — supervisor melihat
 * penandanya di inbox. Tidak mengirim WhatsApp otomatis ke siapa pun agar
 * tidak menambah aktivitas nomor bisnis tanpa perlu (risiko blokir).
 */

import { getPool } from "@/lib/db";
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
      RETURNING id, phone`,
    [Math.max(1, settings.slaResponseMinutes)]
  );

  if (rows.length > 0) {
    console.warn(
      `[cs-sla] ${rows.length} percakapan melewati SLA respons ` +
        `${settings.slaResponseMinutes} menit: ${rows.map((r) => r.phone).join(", ")}`
    );
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
