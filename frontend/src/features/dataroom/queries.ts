"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import type {
  ActivityRow, CommentRow, DataroomItem, DataroomListing, DepartmentRef, DriveView, GrantRow, Person, ShareLogRow,
  ShareRow, VersionRow,
} from "@/features/dataroom/types";

export interface FolderRow { id: string; parent_id: string | null; name: string }

export const dataroomKeys = {
  all: ["dataroom"] as const,
  listing: (folderId: string | null, view: DriveView = "") => ["dataroom", "listing", view || "folder", folderId ?? "root"] as const,
  search: (q: string, tag: string) => ["dataroom", "search", q, tag] as const,
  node: (nodeId: string) => ["dataroom", "node", nodeId] as const,
  tree: ["dataroom", "tree"] as const,
  tags: ["dataroom", "tags"] as const,
  access: (nodeId: string) => ["dataroom", "access", nodeId] as const,
  allShares: ["dataroom", "shares"] as const,
  shares: (nodeId: string | null) => ["dataroom", "shares", nodeId ?? "all"] as const,
  shareLogs: (shareId: string) => ["dataroom", "share-logs", shareId] as const,
  versions: (nodeId: string) => ["dataroom", "versions", nodeId] as const,
  comments: (nodeId: string) => ["dataroom", "comments", nodeId] as const,
  activity: (nodeId: string | null) => ["dataroom", "activity", nodeId ?? "root"] as const,
  permissions: (nodeId: string) => ["dataroom", "permissions", nodeId] as const,
  people: (q: string) => ["dataroom", "people", q] as const,
};

/** URL unduh / pratinjau file Dataroom (API ber-auth). */
export const nodeFileUrl = (nodeId: string, inline = false) =>
  `/api/dataroom/nodes/${nodeId}/download${inline ? "?inline=1" : ""}`;

export const versionFileUrl = (nodeId: string, versionId: string) =>
  `/api/dataroom/nodes/${nodeId}/versions/${versionId}/download`;

/** Unduh lewat anchor sementara; API mengirim Content-Disposition: attachment. */
export function startDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

const data = <T,>(res: { data: T }) => res.data;

export const useDataroomListing = (folderId: string | null, view: DriveView = "") =>
  useQuery({
    queryKey: dataroomKeys.listing(folderId, view),
    queryFn: () => {
      const params = new URLSearchParams();
      if (view) params.set("view", view);
      else if (folderId) params.set("parent", folderId);
      const qs = params.toString();
      return apiGet<{ data: DataroomListing }>(`/api/dataroom/nodes${qs ? `?${qs}` : ""}`).then(data);
    },
  });

export const useDataroomSearch = (q: string, tag: string) =>
  useQuery({
    queryKey: dataroomKeys.search(q, tag),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (tag) params.set("tag", tag);
      return apiGet<{ data: { items: DataroomItem[] } }>(`/api/dataroom/search?${params.toString()}`).then((res) => res.data.items);
    },
    enabled: q.trim().length > 0 || tag.length > 0,
  });

export const useDataroomNode = (nodeId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.node(nodeId ?? ""),
    queryFn: () => apiGet<{ data: DataroomItem }>(`/api/dataroom/nodes/${nodeId}`).then(data),
    enabled: nodeId !== null,
  });

export const useFolderTree = () =>
  useQuery({
    queryKey: dataroomKeys.tree,
    queryFn: () => apiGet<{ data: FolderRow[] }>("/api/dataroom/tree").then(data),
  });

export const useDataroomTags = () =>
  useQuery({
    queryKey: dataroomKeys.tags,
    queryFn: () => apiGet<{ data: { tag: string; count: number }[] }>("/api/dataroom/tags").then(data),
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
      apiGet<{ data: ShareRow[] }>(nodeId ? `/api/dataroom/shares?node_id=${nodeId}` : "/api/dataroom/shares").then(data),
  });

export const useShareLogs = (shareId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.shareLogs(shareId ?? ""),
    queryFn: () =>
      apiGet<{ data: { logs: ShareLogRow[] } }>(`/api/dataroom/shares/${shareId}`).then((res) => res.data.logs),
    enabled: shareId !== null,
  });

export const useVersions = (nodeId: string) =>
  useQuery({
    queryKey: dataroomKeys.versions(nodeId),
    queryFn: () => apiGet<{ data: VersionRow[] }>(`/api/dataroom/nodes/${nodeId}/versions`).then(data),
  });

export const useComments = (nodeId: string) =>
  useQuery({
    queryKey: dataroomKeys.comments(nodeId),
    queryFn: () => apiGet<{ data: CommentRow[] }>(`/api/dataroom/nodes/${nodeId}/comments`).then(data),
  });

export const useActivity = (nodeId: string | null) =>
  useQuery({
    queryKey: dataroomKeys.activity(nodeId),
    queryFn: () =>
      apiGet<{ data: ActivityRow[] }>(nodeId ? `/api/dataroom/nodes/${nodeId}/activity` : "/api/dataroom/activity").then(data),
  });

export const usePermissions = (nodeId: string) =>
  useQuery({
    queryKey: dataroomKeys.permissions(nodeId),
    queryFn: () =>
      apiGet<{ data: { grants: GrantRow[]; can_manage: boolean; my_level: string } }>(`/api/dataroom/nodes/${nodeId}/permissions`).then(data),
  });

export const usePeople = (q: string) =>
  useQuery({
    queryKey: dataroomKeys.people(q),
    queryFn: () => apiGet<{ data: Person[] }>(`/api/dataroom/people?q=${encodeURIComponent(q)}`).then(data),
    staleTime: 60_000,
  });
