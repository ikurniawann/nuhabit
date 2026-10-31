"use client";

import type { ComponentProps } from "react";
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
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (digits: string) => void;
}) {
  const display = value ? formatRupiah(value) : "";

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onValueChange(digits);
      }}
      placeholder={placeholder}
    />
  );
}
