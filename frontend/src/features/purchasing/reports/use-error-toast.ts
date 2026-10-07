"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/** Tampilkan toast sekali setiap kali query/mutasi menghasilkan error baru. */
export function useErrorToast(error: unknown, fallback: string) {
  useEffect(() => {
    if (error) toast.error(error instanceof Error ? error.message : fallback);
  }, [error, fallback]);
}
