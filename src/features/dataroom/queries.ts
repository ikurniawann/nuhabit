"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import type { DataroomListing, DepartmentRef, ShareLogRow, ShareRow } from "@/features/dataroom/types";

export interface FolderRow { id: string; parent_id: string | null; name: string }

export const dataroomKeys = {
  all: ["dataroom"] as const,
  listing: (folderId: string | null) => ["dataroom", "listing", folderId ?? "root"] as const,
  tree: ["dataroom", "tree"] as const,
  access: (nodeId: string) => ["dataroom", "access", nodeId] as const,
  allShares: ["dataroom", "shares"] as const,
  shares: (nodeId: string | null) => ["dataroom", "shares", nodeId ?? "all"] as const,
  shareLogs: (shareId: string) => ["dataroom", "share-logs", shareId] as const,
};

/** URL unduh / pratinjau file Dataroom (API ber-auth). */
export const nodeFileUrl = (nodeId: string, inline = false) =>
  `/api/dataroom/nodes/${nodeId}/download${inline ? "?inline=1" : ""}`;

/** Unduh lewat anchor sementara; API mengirim Content-Disposition: attachment. */
export function startDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export const useDataroomListing = (folderId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.listing(folderId),
    queryFn: () =>
      apiGet<{ data: DataroomListing }>(`/api/dataroom/nodes${folderId ? `?parent=${folderId}` : ""}`).then(
        (res) => res.data
      ),
  });

export const useFolderTree = () =>
  useQuery({
    queryKey: dataroomKeys.tree,
    queryFn: () => apiGet<{ data: FolderRow[] }>("/api/dataroom/tree").then((res) => res.data),
  });

/** Daftar departemen + akses folder saat ini (dialog "Atur akses departemen"). */
export const useFolderAccess = (nodeId: string) =>
  useQuery({
    queryKey: dataroomKeys.access(nodeId),
    queryFn: async () => {
      const [departments, current] = await Promise.all([
        apiGet<{ data: DepartmentRef[] }>("/api/dataroom/departments"),
        apiGet<{ data: { departments: DepartmentRef[] } }>(`/api/dataroom/nodes/${nodeId}/access`),
      ]);
      return { departments: departments.data, selectedIds: current.data.departments.map((d) => d.id) };
    },
    gcTime: 0,
  });

export const useShares = (nodeId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.shares(nodeId),
    queryFn: () =>
      apiGet<{ data: ShareRow[] }>(nodeId ? `/api/dataroom/shares?node_id=${nodeId}` : "/api/dataroom/shares").then(
        (res) => res.data
      ),
  });

export const useShareLogs = (shareId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.shareLogs(shareId ?? ""),
    queryFn: () =>
      apiGet<{ data: { logs: ShareLogRow[] } }>(`/api/dataroom/shares/${shareId}`).then((res) => res.data.logs),
    enabled: shareId !== null,
  });
