"use client";

import {
  Banknote,
  Coins,
  CreditCard,
  Gift,
  QrCode,
  Ticket,
  type LucideIcon,
} from "lucide-react";

import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
} from "@/lib/pos/central-cashier";
import { cn } from "@/lib/utils";

import type { PaymentOption, TenderContext } from "./payment-state";

const ICON_BY_KEY: Record<string, LucideIcon> = {
  banknote: Banknote,
  "qr-code": QrCode,
  "credit-card": CreditCard,
  coins: Coins,
  ticket: Ticket,
  gift: Gift,
  cash: Banknote,
  qris: QrCode,
  credit_card: CreditCard,
  ark_coin: Coins,
  nfc_tab: Ticket,
  gift_card: Gift,
};

interface MethodGridProps {
  options: PaymentOption[];
  selectedCode: string;
  tenders: TenderContext;
  disabled: boolean;
  /** Saldo ARK member terformat, tampil sebagai deskripsi opsi ARK Coin. */
  arkBalanceLabel: string;
  onPick: (option: PaymentOption) => void;
}

export function MethodGrid({
  options,
  selectedCode,
  tenders,
  disabled,
  arkBalanceLabel,
  onPick,
}: MethodGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option) => {
        const Icon = ICON_BY_KEY[option.icon] || ICON_BY_KEY[option.code] || Banknote;
        const selected = selectedCode === option.code;
        const mixedBlocked =
          tenders.isMixedCart && isMixedUnsupportedTender(option.cashierKey);
        const checkoutBlocked =
          tenders.isCheckoutBill && isCheckoutBillUnsupportedTender(option.cashierKey);
        const blocked = mixedBlocked || checkoutBlocked;
        const desc =
          checkoutBlocked && option.cashierKey === "ark_coin"
            ? MIXED_ARK_UNSUPPORTED_MESSAGE
            : blocked
              ? MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE
              : option.cashierKey === "ark_coin"
                ? arkBalanceLabel
                : option.desc;

        return (
          <button
            key={option.code}
            type="button"
            disabled={disabled || blocked}
            onClick={() => {
              if (!blocked) onPick(option);
            }}
            className={cn(
              "flex min-h-[5.5rem] flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors",
              selected
                ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5",
              (disabled || blocked) && "cursor-not-allowed opacity-60"
            )}
          >
            <Icon
              className={cn("h-5 w-5", selected ? "text-brand-text" : "text-muted-foreground")}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{option.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
