"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useCategories } from "../queries";

interface CategoryAutocompleteProps {
  /** Nama kategori terpilih/diketik — dikirim sebagai category_name (auto-add). */
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

/**
 * Autocomplete kategori dengan auto-add: pilih dari saran, atau ketik nama
 * baru — server membuat kategori otomatis saat submit ticket.
 */
export function CategoryAutocomplete({
  value,
  onChange,
  disabled,
}: CategoryAutocompleteProps) {
  const [focused, setFocused] = useState(false);
  const categoriesQuery = useCategories(value.trim());
  const suggestions = categoriesQuery.data ?? [];

  const showList =
    focused &&
    value.trim() !== "" &&
    !suggestions.some((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  const exactMatch = suggestions.some(
    (c) => c.name.toLowerCase() === value.trim().toLowerCase()
  );

  return (
    <div className="relative">
      <Input
        placeholder="mis. Reguler, Bundling, Event…"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && (suggestions.length > 0 || showList) ? (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {suggestions.map((category) => (
            <button
              key={category.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(category.name);
                setFocused(false);
              }}
            >
              {category.name}
            </button>
          ))}
          {showList && !exactMatch ? (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-pink-600 hover:bg-pink-50"
              onMouseDown={(e) => {
                e.preventDefault();
                setFocused(false);
              }}
            >
              + Tambah kategori “{value.trim()}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
