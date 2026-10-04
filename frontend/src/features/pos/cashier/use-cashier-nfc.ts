"use client";

/**
 * Tap kartu NFC / scan QR member di kasir: pilih member, tawarkan buat member
 * baru (kartu belum terhubung), atau tawarkan top up (saldo ARK kurang saat
 * membayar). Scan dari reader global masuk lewat event POS_NFC_CARD_EVENT.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CustomerWithDiscount } from "@/lib/pos-api";
import { isMemberQrToken } from "@/lib/crm/engagement/rules";
import { findCustomerByCard, POS_NFC_CARD_EVENT, usePosNfcOptional } from "@/features/pos/nfc";
import { resolveMemberQr } from "./api";
import { resolveCashierNfcAction } from "./nfc-scan-action";

export type CardPrompt =
  | { kind: "create"; uid: string }
  | { kind: "topup"; uid: string; balance: number; name?: string | null };

const CLOSED_NFC = { open: false, input: "", searching: false, error: "" };

export function useCashierNfc(deps: {
  customers: CustomerWithDiscount[];
  totalDue: number;
  paymentOpen: boolean;
  arkEnabled: boolean;
  selectCustomer: (customerId: string) => void;
}) {
  const [nfc, setNfc] = useState(CLOSED_NFC);
  const [prompt, setPrompt] = useState<CardPrompt | null>(null);
  const setPaymentNfcActive = usePosNfcOptional()?.setPaymentNfcActive;

  // Kasir mengklaim semua scan NFC: pilih/buat member, bukan diarahkan ke top up.
  useEffect(() => {
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  const resolveQr = async (token: string) => {
    try {
      const data = await resolveMemberQr(token);
      const member = deps.customers.find((c) => c.id === data.customer_id);
      if (!member) throw new Error("Member belum ada di daftar kasir. Muat ulang halaman kasir.");
      deps.selectCustomer(member.id);
      setNfc(CLOSED_NFC);
      toast.success(`Member ${member.name || member.phone} dipilih lewat QR`, {
        description: data.gym?.message ? `Gym: ${data.gym.message}` : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "QR member tidak valid";
      setNfc((prev) => ({ ...prev, searching: false, input: "", error: message }));
      toast.error(message);
    }
  };

  const processCard = (cardData: string) => {
    const trimmed = cardData.trim();
    if (!trimmed) return;

    // QR kartu member (portal /member): token sekali pakai, diperiksa server.
    if (isMemberQrToken(trimmed)) {
      setNfc((prev) => ({ ...prev, searching: true, error: "" }));
      void resolveQr(trimmed);
      return;
    }

    const found = findCustomerByCard(deps.customers, trimmed);
    const action = resolveCashierNfcAction({
      memberFound: Boolean(found),
      balance: Number(found?.ark_coin_balance || 0),
      totalDue: deps.totalDue,
      enforceArkBalance: deps.paymentOpen || nfc.open,
    });
    setNfc((prev) => ({ ...prev, searching: false, input: "", error: "" }));

    if (action === "create") {
      setNfc(CLOSED_NFC);
      setPrompt({ kind: "create", uid: trimmed.toUpperCase() });
      return;
    }
    if (!found) return;
    if (action === "topup" && deps.arkEnabled) {
      setNfc(CLOSED_NFC);
      setPrompt({
        kind: "topup",
        uid: (found.nfc_uid || trimmed).toUpperCase(),
        balance: Number(found.ark_coin_balance || 0),
        name: found.name,
      });
      deps.selectCustomer(found.id);
      return;
    }
    deps.selectCustomer(found.id);
    setNfc(CLOSED_NFC);
    toast.success(`Member ${found.name || found.phone} selected`);
  };

  useEffect(() => {
    function onBridgeCard(event: Event) {
      const card = (event as CustomEvent<{ card?: string }>).detail?.card;
      if (card) processCard(card);
    }
    window.addEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
  });

  return {
    nfc,
    prompt,
    openNfc: () => setNfc((prev) => ({ ...prev, open: true })),
    cancelNfc: () => setNfc(CLOSED_NFC),
    setNfcInput: (input: string) => setNfc((prev) => ({ ...prev, input })),
    submitNfc: () => processCard(nfc.input),
    dismissPrompt: () => setPrompt(null),
  };
}
