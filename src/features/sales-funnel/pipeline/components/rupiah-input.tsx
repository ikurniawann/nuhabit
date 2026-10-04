"use client";

import { formatRupiah } from "@/lib/format";
import { Input } from "@/components/ui/input";

/**
 * Input nominal uang ber-format Rupiah saat diketik (Rp 5.000.000).
 * `value` tetap string digit murni (mis. "5000000") agar Number(value)
 * di pemanggil tidak berubah perilaku.
 */
export function RupiahInput({
  value,
  onValueChange,
  placeholder = "Rp 0",
  className,
}: {
  value: string;
  onValueChange: (digits: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const display = value ? formatRupiah(value) : "";

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onValueChange(digits);
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}
