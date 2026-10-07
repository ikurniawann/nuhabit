/**
 * EPIC-020 Fase B — pengirim notifikasi WA owner.
 *
 * Aturan main:
 * 1. Master mati / jenis mati / tanpa penerima → senyap total (AC epic).
 * 2. Klaim baris wa_notif_log SEBELUM kirim (INSERT ON CONFLICT DO NOTHING)
 *    — kejadian yang sama tidak pernah terkirim dua kali walau dipicu dari
 *    dua proses/route sekaligus.
 * 3. Gateway menolak dengan jelas di SEMUA nomor → klaim dilepas supaya
 *    dicoba lagi; timeout (status tak pasti) → klaim dipertahankan,
 *    at-most-once menang (pola followup-reminder-watcher).
 */

import { getPool } from "@/lib/db";
import { getSetting } from "@/lib/settings/app-settings";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import {
  WA_NOTIF_SETTING_KEY,
  parseWaNotifConfig,
  type WaNotifConfig,
  type WaNotifType,
} from "./notifications-config";

export async function getWaNotifConfig(): Promise<WaNotifConfig> {
  return parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
}

/** Klaim atomik kunci dedup — hanya kunci yang BELUM pernah ada yang kembali. */
export async function claimNotifKeys(
  type: WaNotifType,
  keys: { dedupKey: string; message: string }[],
  recipients: string[]
): Promise<{ id: string; dedupKey: string }[]> {
  if (keys.length === 0) return [];
  const pool = getPool();
  const claimed: { id: string; dedupKey: string }[] = [];
  for (const key of keys) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (notif_type, dedup_key) DO NOTHING
       RETURNING id`,
      [type, key.dedupKey, key.message, JSON.stringify(recipients)]
    );
    if (result.rows.length > 0) {
      claimed.push({ id: result.rows[0].id, dedupKey: key.dedupKey });
    }
  }
  return claimed;
}

/** Lepas klaim (kegagalan jelas) supaya kejadiannya dicoba kirim lagi nanti. */
export async function releaseNotifKeys(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getPool().query(
    `DELETE FROM configuration.wa_notif_log WHERE id = ANY($1::uuid[])`,
    [ids]
  );
}

/**
 * Kirim satu pesan ke semua penerima config.
 * delivered = jumlah sukses; timedOut = ada pengiriman berstatus tak pasti.
 */
export async function deliverToRecipients(
  config: WaNotifConfig,
  message: string
): Promise<{ delivered: number; timedOut: boolean }> {
  const gateway = await loadGatewayConfig();
  if (!gateway) return { delivered: 0, timedOut: false };

  let delivered = 0;
  let timedOut = false;
  for (const recipient of config.recipients) {
    const result = await sendGatewayText(gateway, {
      target: recipient,
      message,
    });
    if (result.success) {
      delivered += 1;
    } else if (result.timedOut) {
      timedOut = true;
    } else {
      console.error(`[wa-notif] gagal kirim ke ${recipient}: ${result.reason}`);
    }
  }
  return { delivered, timedOut };
}

export interface SendOwnerNotifInput {
  type: WaNotifType;
  /** Unik per kejadian — kunci dedup di wa_notif_log. */
  dedupKey: string;
  message: string;
  /** Config yang sudah dibaca pemanggil — hemat satu query bila ada. */
  config?: WaNotifConfig;
}

export type SendOwnerNotifResult =
  | { sent: true; recipients: number }
  | {
      sent: false;
      reason:
        | "master-mati"
        | "jenis-mati"
        | "tanpa-penerima"
        | "gateway-belum-dikonfigurasi"
        | "duplikat"
        | "gateway-gagal";
    };

export async function sendOwnerNotification(
  input: SendOwnerNotifInput
): Promise<SendOwnerNotifResult> {
  const config = input.config ?? (await getWaNotifConfig());
  if (!config.enabled) return { sent: false, reason: "master-mati" };
  if (!config.types[input.type]) return { sent: false, reason: "jenis-mati" };
  if (config.recipients.length === 0) {
    return { sent: false, reason: "tanpa-penerima" };
  }
  if (!await loadGatewayConfig()) {
    return { sent: false, reason: "gateway-belum-dikonfigurasi" };
  }

  const claimed = await claimNotifKeys(
    input.type,
    [{ dedupKey: input.dedupKey, message: input.message }],
    config.recipients
  );
  if (claimed.length === 0) return { sent: false, reason: "duplikat" };

  const { delivered, timedOut } = await deliverToRecipients(
    config,
    input.message
  );
  if (delivered === 0 && !timedOut) {
    await releaseNotifKeys(claimed.map((c) => c.id));
    return { sent: false, reason: "gateway-gagal" };
  }
  return { sent: true, recipients: delivered };
}

/**
 * Versi tembak-dan-lupakan untuk kait di jalur transaksi (mis. void POS):
 * notifikasi TIDAK BOLEH menggagalkan atau memperlambat operasi utamanya.
 */
export function fireOwnerNotification(input: SendOwnerNotifInput): void {
  sendOwnerNotification(input).catch((error) => {
    console.error(`[wa-notif] ${input.type} gagal terkirim:`, error);
  });
}
