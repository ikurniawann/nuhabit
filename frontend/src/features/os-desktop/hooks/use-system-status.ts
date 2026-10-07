"use client";

import { useQuery } from "@tanstack/react-query";
import type { StatusItem, StatusLevel } from "@/lib/desktop/status";

export type SystemStatus = { items: StatusItem[]; level: StatusLevel };

/** Lampu status layanan (database, antrian cetak, WhatsApp), diperbarui tiap 60 detik. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["os-desktop", "status"],
    // Gagal → lempar, supaya status terakhir yang diketahui tetap tampil.
    queryFn: async (): Promise<SystemStatus> => {
      const res = await fetch("/api/desktop/status");
      const json = res.ok ? await res.json() : null;
      if (!json?.data) throw new Error("status tidak tersedia");
      return json.data as SystemStatus;
    },
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  });
}
