/**
 * EPIC-011 lanjutan — aturan perolehan XP.
 *
 * Tanpa satu pun aturan aktif, transaksi POS menghasilkan 0 XP: mesin
 * loyalty bekerja normal tetapi tidak tahu berapa yang harus diberikan.
 */

export const XP_SOURCE_CHANNELS = ["pos", "photobooth", "studio_game", "manual", "campaign"] as const;
export type XpSourceChannel = (typeof XP_SOURCE_CHANNELS)[number];

/**
 * Jenis kejadian yang BENAR-BENAR dicocokkan mesin loyalty
 * (`findBestRule` di lib/crm/loyalty-rules.ts). Nilai di luar daftar ini
 * akan tersimpan rapi tetapi tidak pernah cocok, sehingga aturannya diam-diam
 * tidak berlaku — karena itu di form dibuat sebagai pilihan, bukan teks bebas.
 */
export const XP_SOURCE_TYPES = ["product", "order_amount", "split_payment"] as const;
export type XpSourceType = (typeof XP_SOURCE_TYPES)[number];

export const XP_MODES = ["fixed", "per_item", "per_amount", "multiplier", "percentage"] as const;
export type XpMode = (typeof XP_MODES)[number];

export interface XpRule {
  id: string;
  code: string;
  name: string;
  source_channel: XpSourceChannel;
  source_type: string;
  source_id: string | null;
  outlet_scope: "all" | "specific";
  outlet_id: string | null;
  xp_mode: XpMode;
  xp_value: number;
  amount_step: number;
  min_amount: number;
  max_xp_per_event: number | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface XpRulesListParams {
  source_channel?: string;
}

export interface SaveXpRulePayload {
  code: string;
  name: string;
  source_channel: XpSourceChannel;
  source_type: string;
  source_id: string | null;
  outlet_scope: "all" | "specific";
  outlet_id: string | null;
  xp_mode: XpMode;
  xp_value: number;
  amount_step: number;
  min_amount: number;
  max_xp_per_event: number | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

/** Bentuk form — angka disimpan sebagai string agar input bisa dikosongkan. */
export interface XpRuleForm {
  id: string;
  code: string;
  name: string;
  source_channel: XpSourceChannel;
  source_type: string;
  xp_mode: XpMode;
  xp_value: string;
  amount_step: string;
  min_amount: string;
  max_xp_per_event: string;
  tier_multiplier_enabled: boolean;
  priority: string;
  is_active: boolean;
}
