"use client";

// Pemilih multi produk/kategori ber-pencarian untuk target kode promo.

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface TargetOption {
  id: string;
  label: string;
}

export function TargetPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  options: TargetOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const labelOf = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return options
      .filter((o) => !value.includes(o.id) && o.label.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [options, search, value]);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              {labelOf.get(id) ?? "Item terhapus"}
              <button
                type="button"
                aria-label={`Hapus ${labelOf.get(id) ?? "item"}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="rounded-full p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        value={search}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setSearch(e.target.value)}
      />
      {matches.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-xl bg-surface-2 p-1">
          {matches.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-card"
                onClick={() => {
                  onChange([...value, option.id]);
                  setSearch("");
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
