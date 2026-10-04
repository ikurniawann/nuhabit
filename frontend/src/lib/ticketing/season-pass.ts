// EPIC-028 — helper server Season Pass: hitung masa berlaku rolling,
// generate kode pass, dan konstanta kebijakan entry. QR/token reuse
// generateAccessToken() dari booking (opaque, tak ter-enumerasi).

import type { PoolClient } from "pg";

export const PASS_ENTRY_POLICIES = [
  "once_per_day",
  "unlimited",
  "limited_visits",
] as const;
export type PassEntryPolicy = (typeof PASS_ENTRY_POLICIES)[number];

export const PASS_STATUSES = [
  "pending",
  "active",
  "expired",
  "suspended",
  "cancelled",
] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

/**
 * Rolling masa berlaku: valid_until = tanggal + N bulan. Memakai aritmetika
 * bulan UTC (Jan 31 + 1 bln bisa meluber ke awal Maret — dapat diterima untuk
 * durasi bulanan; MVP tidak meng-clamp akhir bulan).
 */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

/**
 * Kode pass unik per venue+hari: SP-YYYYMMDD-#### (increment dari MAX hari ini).
 * Unique constraint pass_code jadi jaring pengaman race.
 */
export async function generatePassCode(
  client: PoolClient,
  branchId: string,
  todayIso: string
): Promise<string> {
  const prefix = `SP-${todayIso.replace(/-/g, "")}`;
  const { rows } = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(NULLIF(substring(pass_code from '[0-9]+$'), '')::int), 0) + 1 AS next
     FROM ticketing.ticket_season_passes
     WHERE branch_id = $1 AND pass_code LIKE $2`,
    [branchId, `${prefix}-%`]
  );
  return `${prefix}-${String(Number(rows[0]?.next ?? 1)).padStart(4, "0")}`;
}
