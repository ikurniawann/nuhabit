"use client";

import { useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/** Kotak cari daftar: `query` mengikuti ketikan, `search` (trim) menyusul setelah jeda. */
export function useDebouncedSearch(delayMs = 300) {
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), delayMs);
  return { query, setQuery, search };
}
