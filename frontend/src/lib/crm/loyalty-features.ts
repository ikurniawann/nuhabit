/**
 * Saklar fitur loyalty per instance: ARK Coin (dompet/saldo member) dan XP
 * (poin pengalaman, level, badge, avatar, reward). Diatur Super Admin di
 * CRM → Pengaturan; disimpan di crm.crm_settings (`ark_coin_enabled`,
 * `xp_enabled`).
 *
 * Nonaktif berarti fitur disembunyikan dari menu (sidebar, desktop, navigasi
 * POS — dan karena layout menjaga path berdasarkan menu, halamannya ikut
 * tertutup), metode bayar ARK Coin hilang dari kasir, dan API yang memakai
 * saldo ARK menolak. Data (saldo, riwayat XP) TIDAK dihapus, jadi mengaktifkan
 * kembali memulihkan semuanya.
 *
 * Default AKTIF: key yang belum ada (instance lama) = perilaku lama.
 */

export const ARK_COIN_SETTING_KEY = "ark_coin_enabled";
export const XP_SETTING_KEY = "xp_enabled";

export type LoyaltyFeatures = {
  arkCoin: boolean;
  xp: boolean;
};

export const DEFAULT_LOYALTY_FEATURES: LoyaltyFeatures = { arkCoin: true, xp: true };

/** Metode bayar yang bergantung pada fitur ARK Coin. */
export const ARK_COIN_PAYMENT_METHOD_CODE = "ark_coin";

/**
 * Menu IAM yang bergantung pada fitur. "any" = tampil selama salah satu fitur
 * aktif (halaman pengaturan gabungan "ARK & XP").
 */
export const MENU_FEATURE_RULES: Record<string, "arkCoin" | "xp" | "any"> = {
  // POS › Member
  "pos.loyalty.topup": "arkCoin",
  "pos.loyalty.unlink-card": "arkCoin",
  "pos.loyalty.settings": "any",
  // CRM › Members & Loyalty — gamifikasi berbasis XP
  "crm.loyalty.rewards": "xp",
  "crm.loyalty.avatars": "xp",
  "crm.badges": "xp",
};

/**
 * Halaman per fitur. Layout dashboard sudah menjaga path lewat menu, tapi
 * layout POS hanya memeriksa izin modul — jadi route POS dijaga eksplisit.
 */
export const ROUTE_FEATURE_RULES: Record<string, "arkCoin" | "xp" | "any"> = {
  "/dashboard/pos/topup": "arkCoin",
  "/dashboard/pos/unlink-card": "arkCoin",
  "/dashboard/pos/loyalty-settings": "any",
  "/dashboard/crm/rewards": "xp",
  "/dashboard/crm/avatars": "xp",
  "/dashboard/crm/badges": "xp",
  "/dashboard/crm/xp-rules": "xp",
};

function ruleEnabled(rule: "arkCoin" | "xp" | "any", features: LoyaltyFeatures): boolean {
  return rule === "any" ? features.arkCoin || features.xp : features[rule];
}

/** Pure: apakah halaman ini boleh dibuka (cocok prefix, termasuk sub-path). */
export function isPathEnabled(pathname: string, features: LoyaltyFeatures): boolean {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  for (const [prefix, rule] of Object.entries(ROUTE_FEATURE_RULES)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return ruleEnabled(rule, features);
  }
  return true;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

/** Pure: baris crm_settings (value jsonb) → flag, dengan default aktif. */
export function parseLoyaltyFeatures(rows: Array<{ key: string; value: unknown }>): LoyaltyFeatures {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    arkCoin: toBool(byKey.get(ARK_COIN_SETTING_KEY), DEFAULT_LOYALTY_FEATURES.arkCoin),
    xp: toBool(byKey.get(XP_SETTING_KEY), DEFAULT_LOYALTY_FEATURES.xp),
  };
}

/** Pure: apakah menu dengan kode ini boleh tampil untuk kombinasi flag. */
export function isMenuCodeEnabled(code: string | null | undefined, features: LoyaltyFeatures): boolean {
  if (!code) return true;
  const rule = MENU_FEATURE_RULES[code];
  return rule ? ruleEnabled(rule, features) : true;
}

/** Pure: saring baris menu (kode IAM) menurut flag. */
export function filterMenusByLoyaltyFeatures<T extends { code: string | null }>(
  menus: T[],
  features: LoyaltyFeatures
): T[] {
  return menus.filter((menu) => isMenuCodeEnabled(menu.code, features));
}

/** Pure: apakah metode bayar ini boleh dipakai. */
export function isPaymentMethodEnabled(code: string, features: LoyaltyFeatures): boolean {
  return code !== ARK_COIN_PAYMENT_METHOD_CODE || features.arkCoin;
}

export const ARK_COIN_DISABLED_MESSAGE = "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM";
