"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { WaNotifConfig, WaNotifTypeMeta } from "@/lib/wa/notifications-config";

export type WaNotifSettings = {
  config: WaNotifConfig;
  catalog: WaNotifTypeMeta[];
  shiftRecipients: string[];
};

const ENDPOINT = "/api/settings/wa-notifications";

async function request<T>(input: string, init: RequestInit | undefined, fallbackError: string): Promise<T> {
  const res = await fetch(input, init);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || fallbackError);
  return json.data as T;
}

export function useWaNotifSettings() {
  return useQuery({
    queryKey: ["os-desktop", "wa-notif-settings"],
    queryFn: async (): Promise<WaNotifSettings> => {
      const data = await request<{ config: WaNotifConfig; catalog: WaNotifTypeMeta[]; shift_report_recipients?: unknown }>(
        ENDPOINT,
        undefined,
        "Gagal memuat"
      );
      return {
        config: data.config,
        catalog: data.catalog,
        shiftRecipients: Array.isArray(data.shift_report_recipients) ? data.shift_report_recipients : [],
      };
    },
    retry: false,
    // Selalu dimuat segar saat panel dibuka: form menyalin data ini sebagai draf.
    gcTime: 0,
  });
}

export function useSaveWaNotifSettings() {
  return useMutation({
    retry: false,
    mutationFn: (input: { config: WaNotifConfig; shiftRecipients: string[] }) =>
      request<{ config: WaNotifConfig }>(
        ENDPOINT,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input.config, shift_report_recipients: input.shiftRecipients }),
        },
        "Gagal menyimpan"
      ),
  });
}

type TestResult = { target: string; success: boolean; reason: string | null };

/** Kirim pesan uji (atau Flash Report) ke nomor yang TERSIMPAN. */
export function useSendWaNotifTest() {
  return useMutation({
    retry: false,
    mutationFn: async (flash: boolean) => {
      const data = await request<{ results: TestResult[] }>(
        `${ENDPOINT}/test`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(flash ? { flash: true } : {}) },
        "Gagal mengirim tes"
      );
      return data.results.map((r) => `${r.target}: ${r.success ? "terkirim ✓" : `gagal — ${r.reason ?? "?"}`}`).join("\n");
    },
  });
}
