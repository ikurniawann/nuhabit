export type {
  PosLoyaltySettings,
  TopupXpMode,
} from "@/lib/pos/loyalty-settings";

export type UpdateLoyaltySettingsPayload = {
  ark_rate: number;
  topup_min_amount: number;
  topup_presets: number[];
  topup_xp_enabled: boolean;
  topup_xp_mode: "fixed" | "per_amount";
  topup_xp_value: number;
  topup_xp_amount_step: number;
  spend_xp_enabled: boolean;
  spend_xp_amount_step: number;
  spend_xp_min: number;
};
