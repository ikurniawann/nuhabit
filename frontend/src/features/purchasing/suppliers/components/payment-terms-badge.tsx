import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PAYMENT_TERMS_BADGE_STYLES,
  PAYMENT_TERMS_OPTIONS,
  getPaymentTermsLabel,
  type PaymentTerms,
} from "@/types/supplier";

type PaymentTermsBadgeProps = {
  value: PaymentTerms;
  className?: string;
};

export function PaymentTermsBadge({ value, className }: PaymentTermsBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium",
        PAYMENT_TERMS_BADGE_STYLES[value],
        className
      )}
    >
      {getPaymentTermsLabel(value)}
    </Badge>
  );
}

type PaymentTermsBadgeFilterProps = {
  value: PaymentTerms | "all";
  onChange: (value: PaymentTerms | "all") => void;
  disabled?: boolean;
};

export function PaymentTermsBadgeFilter({
  value,
  onChange,
  disabled,
}: PaymentTermsBadgeFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("all")}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          value === "all"
            ? "border-pink-200 bg-pink-50 text-pink-700"
            : "border-gray-200/80 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        Semua Termin
      </button>
      {PAYMENT_TERMS_OPTIONS.map((term) => {
        const active = value === term;
        return (
          <button
            key={term}
            type="button"
            disabled={disabled}
            onClick={() => onChange(term)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? PAYMENT_TERMS_BADGE_STYLES[term]
                : "border-gray-200/80 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
              disabled && "pointer-events-none opacity-50"
            )}
          >
            {getPaymentTermsLabel(term)}
          </button>
        );
      })}
    </div>
  );
}
