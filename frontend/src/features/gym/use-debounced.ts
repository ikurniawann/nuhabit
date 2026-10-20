"use client";

import { useEffect, useState } from "react";

/** Nilai yang baru berubah setelah input diam selama ms (kolom cari). */
export function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
