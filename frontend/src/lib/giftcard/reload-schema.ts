import { z } from "zod";
import { MAX_GIFT_CARD_VALUE } from "./giftcard";
import { GIFT_CARD_RELOAD_PAYMENT_METHODS } from "./reload-payment-methods";

// Body reload yang sama untuk admin (per id) dan kasir (per kode/scan QR).
export const giftCardReloadSchema = z.object({
  amount: z.number().int().positive().max(MAX_GIFT_CARD_VALUE),
  payment_method: z.enum(
    Object.keys(GIFT_CARD_RELOAD_PAYMENT_METHODS) as [
      keyof typeof GIFT_CARD_RELOAD_PAYMENT_METHODS,
      ...(keyof typeof GIFT_CARD_RELOAD_PAYMENT_METHODS)[],
    ]
  ),
  payment_reference: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export type GiftCardReloadBody = z.infer<typeof giftCardReloadSchema>;
