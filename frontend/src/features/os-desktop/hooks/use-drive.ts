"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import type { ReportExportKey } from "@/lib/pos/report-excel/builders";
import { validateReportRange } from "@/lib/pos/report-period";
import type { DataroomItem, DataroomListing } from "@/features/dataroom/types";

/** Folder departemen di akar Dataroom (sudah difilter hak akses departemen). */
export function useDataroomRoots(enabled: boolean) {
  return useQuery({
    queryKey: ["os-desktop", "dataroom-roots"],
    queryFn: async (): Promise<DataroomItem[]> => {
      const res = await apiGet<{ data: DataroomListing }>("/api/dataroom/nodes");
      return res.data.items.filter((item) => item.kind === "folder");
    },
    enabled,
    retry: false,
  });
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Unduh laporan POS sebagai Excel; hasilnya nama berkas yang terunduh. */
export function useReportDownload() {
  return useMutation({
    retry: false,
    mutationFn: async ({ report, dateFrom, dateTo }: { report: ReportExportKey; dateFrom: string; dateTo: string }) => {
      const invalid = validateReportRange(dateFrom, dateTo);
      if (invalid) throw new Error(invalid);
      const qs = new URLSearchParams({ report, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`/api/pos/reports/export?${qs.toString()}`);
      if (!res.ok || (res.headers.get("content-type") || "").includes("json")) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Gagal (${res.status})`);
      }
      const disposition = res.headers.get("content-disposition") || "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `${report}.xlsx`;
      saveBlob(await res.blob(), name);
      return name;
    },
  });
}
