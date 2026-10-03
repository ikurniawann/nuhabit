// EPIC-033 — watcher pengirim kampanye WA. SATU pesan per tick per venue
// dengan interval ber-jitter: pacing alami anti-ban (≈45–90 pesan/jam
// maksimum teoretis, jauh di bawah itu karena plafon harian).
//
// GERBANG PALING PENTING (keputusan owner 26 Jul): config.enabled default
// FALSE — sebelum WA official siap, watcher ini TIDAK PERNAH menyentuh
// gateway. Semua jalur lain (build antrean, preview, UI) aman dijalankan.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import {
  abortIfFailing,
  activeCampaignBranches,
  campaignTransaction,
  claimNextRecipient,
  countCampaignSentTodayWib,
  countSentTodayWib,
  finishExhaustedCampaigns,
  getCampaignConfig,
  markRecipient,
  startDueScheduledCampaigns,
} from "./campaigns-server";
import { isWithinSendWindow, renderCampaignMessage } from "./campaigns";

const TICK_BASE_MS = 45_000;
const TICK_JITTER_MS = 30_000;

function hourWibNow(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );
}

/**
 * Satu tick: mulai kampanye terjadwal yang jatuh tempo, lalu kirim maksimal
 * 1 pesan WA per venue aktif. Exported utk test.
 */
export async function campaignTick(): Promise<{ sent: number }> {
  await startDueScheduledCampaigns().catch((err) =>
    console.error("[crm-campaign] jadwal error:", err)
  );

  const config = await getCampaignConfig();
  if (!config.enabled) return { sent: 0 };
  if (!isWithinSendWindow(hourWibNow())) return { sent: 0 };

  const gateway = await loadGatewayConfig();
  if (!gateway) return { sent: 0 };

  let sent = 0;
  const branches = await activeCampaignBranches();
  for (const branchId of branches) {
    const sentToday = await countSentTodayWib(branchId);
    if (sentToday >= config.daily_cap) continue;

    await campaignTransaction(async (client) => {
      const claimed = await claimNextRecipient(client, branchId);
      if (!claimed) return;

      // Plafon per kampanye (bila diset) — baris dilepas (rollback implisit
      // TIDAK terjadi; kita cukup tidak menandai, klaim lepas saat commit)
      const campaignCap = await client.query<{ daily_cap: number | null }>(
        `SELECT daily_cap FROM crm.crm_campaigns WHERE id = $1`,
        [claimed.campaign_id]
      );
      const cap = campaignCap.rows[0]?.daily_cap ?? null;
      if (cap !== null) {
        const campaignSent = await countCampaignSentTodayWib(claimed.campaign_id);
        if (campaignSent >= cap) return; // biarkan pending — lanjut besok
      }

      const message = renderCampaignMessage(claimed.message_template, {
        nama: claimed.name,
        kode: claimed.voucher_code,
      });
      const result = await sendGatewayText(gateway, {
        target: claimed.phone,
        message,
      });
      await markRecipient(
        client,
        claimed.id,
        result.success
          ? { status: "sent" }
          : { status: "failed", reason: result.reason ?? "gagal-kirim" }
      );
      if (result.success) sent += 1;
      else await abortIfFailing(client, claimed.campaign_id);
    }).catch((err) =>
      console.error("[crm-campaign] tick error:", err)
    );
  }

  await finishExhaustedCampaigns().catch(() => {});
  return { sent };
}

let started = false;

/** Daftarkan watcher — sekali per proses server (pola watcher lain). */
export function startCampaignWatcher(): void {
  if (started) return;
  started = true;

  const schedule = () => {
    const delay = TICK_BASE_MS + Math.floor(Math.random() * TICK_JITTER_MS);
    setTimeout(async () => {
      try {
        await campaignTick();
      } catch (err) {
        console.error("[crm-campaign] watcher error:", err);
      }
      schedule();
    }, delay);
  };
  schedule();
  console.log("[crm-campaign] watcher terdaftar (master switch dari config)");
}
