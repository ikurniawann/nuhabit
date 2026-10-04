import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import type { CookieReader } from "@/lib/auth/constants";

/**
 * Stall (warehouse) aktif yang dipilih super_admin/admin lewat switcher di
 * sidebar. Disimpan sebagai cookie agar bertahan antar-request.
 *
 * Nilai cookie:
 * - UUID stall → stall tersebut
 * - "all" → eksplisit "Semua Stall"
 * - kosong/tidak ada → belum dipilih; caller boleh fallback ke penempatan user
 */
export const ACTIVE_STALL_COOKIE = "nuhabit-active-stall";
/** Nama lama sebelum rename NüHabit: masih dibaca, tidak ditulis lagi. */
export const LEGACY_ACTIVE_STALL_COOKIE = "arkiv-active-stall";
export const ACTIVE_STALL_ALL = "all";

/** Nilai stall aktif dari cookie baru, jatuh ke cookie lama bila belum ada. */
export function readActiveStallCookie(jar: CookieReader): string | undefined {
  const value =
    jar.get(ACTIVE_STALL_COOKIE)?.value?.trim() ||
    jar.get(LEGACY_ACTIVE_STALL_COOKIE)?.value?.trim();
  return value || undefined;
}

export type ActiveStall = {
  id: string;
  name: string;
  code: string;
};

export type ResolvedActiveStall =
  | { mode: "unset" }
  | { mode: "all" }
  | { mode: "stall"; stall: ActiveStall };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function findActiveStall(warehouseId: string): Promise<ActiveStall | null> {
  if (!UUID_RE.test(warehouseId)) return null;
  return queryOne<ActiveStall>(
    `SELECT id, name, code
     FROM configuration.warehouses
     WHERE id = $1 AND is_active = true`,
    [warehouseId]
  );
}

export async function resolveActiveStallFromCookies(): Promise<ResolvedActiveStall> {
  const value = readActiveStallCookie(await cookies());
  if (!value) return { mode: "unset" };
  if (value === ACTIVE_STALL_ALL) return { mode: "all" };

  const stall = await findActiveStall(value);
  if (!stall) return { mode: "unset" };
  return { mode: "stall", stall };
}

/** @deprecated Prefer resolveActiveStallFromCookies — null tidak membedakan unset vs Semua Stall. */
export async function getActiveStallFromCookies(): Promise<ActiveStall | null> {
  const resolved = await resolveActiveStallFromCookies();
  return resolved.mode === "stall" ? resolved.stall : null;
}
