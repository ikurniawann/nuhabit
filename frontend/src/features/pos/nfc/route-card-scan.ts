import { isMemberQrToken } from "@/lib/crm/engagement/rules";
import { buildTopupCardPath, shouldRedirectNfcScan } from "./resolve-topup-path";

export const POS_NFC_CARD_EVENT = "arkiv-pos-nfc-card";

export type PosNfcCardDetail = { card: string };

export function dispatchPosNfcCard(card: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(POS_NFC_CARD_EVENT, {
      detail: { card: card.trim() } satisfies PosNfcCardDetail,
    })
  );
}

export function routePosNfcCard(input: {
  card: string;
  pathname: string;
  paymentNfcActive: boolean;
  push: (href: string) => void;
}): "redirected" | "dispatched" | "ignored" {
  const card = input.card.trim();
  if (!card) return "ignored";

  // QR kartu member selalu ke kasir (pilih member), bukan ke halaman top-up.
  if (input.paymentNfcActive || isMemberQrToken(card)) {
    dispatchPosNfcCard(card);
    return "dispatched";
  }

  if (
    !shouldRedirectNfcScan({
      pathname: input.pathname,
      paymentNfcActive: false,
    })
  ) {
    return "ignored";
  }

  input.push(buildTopupCardPath(card));
  return "redirected";
}
