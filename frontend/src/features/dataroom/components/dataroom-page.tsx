"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2, ChevronRight, Clock, Copy, Download, Eye, FolderInput, FolderOpen, FolderPlus, FolderUp, HardDrive, Info,
  LayoutGrid, Link2, List, Loader2, Lock, Pencil, Plus, RefreshCw, RotateCcw, Search, Share2, Shield, Star, StarOff, Tag,
  Trash2, Unlock, Upload, UploadCloud, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { DATAROOM_MAX_FILE_BYTES, formatBytes } from "@/lib/dataroom/config";
import { readDroppedEntries, readPickedEntries } from "@/lib/dataroom/directory-reader";
import { atLeast, canPreview, moveFocus, purgeDaysLeft, sortItems, type SortDir, type SortKey } from "@/lib/dataroom/drive";
import { cn } from "@/lib/utils";
import { AccessDialog } from "@/features/dataroom/components/access-dialog";
import { ContextMenu, type MenuEntry } from "@/features/dataroom/components/context-menu";
import { DetailsPanel } from "@/features/dataroom/components/details-panel";
import { DeleteDialog, MoveDialog, NameDialog } from "@/features/dataroom/components/dialogs";
import { ItemGrid, ItemTable, type ItemInteractions, type SortState } from "@/features/dataroom/components/item-views";
import { PermissionsDialog } from "@/features/dataroom/components/permissions-dialog";
import { PreviewDialog } from "@/features/dataroom/components/preview-dialog";
import { ShareDialog } from "@/features/dataroom/components/share-dialog";
import { UploadPanel } from "@/features/dataroom/components/upload-panel";
import { useUploadQueue } from "@/features/dataroom/hooks/use-upload-queue";
import { useViewMode } from "@/features/dataroom/hooks/use-view-mode";
import {
  dataroomKeys, nodeFileUrl, startDownload, useDataroomListing, useDataroomNode, useDataroomSearch, useDataroomTags,
} from "@/features/dataroom/queries";
import type { DataroomItem, DriveView } from "@/features/dataroom/types";

/**
 * Dataroom: pengganti Google Drive perusahaan. Folder bersarang, unggah
 * file dan folder (drag & drop, berpotongan untuk file besar), pindah,
 * salin, sampah dengan pemulihan, bintang, terbaru, dibagikan ke saya,
 * pencarian teks penuh dan tag, versi, komentar, kunci edit, hak akses per
 * pengguna/peran, link berbagi, navigasi keyboard dan aksi massal.
 */

const DND_MIME = "application/x-dataroom-ids";

type Dialog =
  | { kind: "new-folder" }
  | { kind: "rename"; item: DataroomItem }
  | { kind: "move"; items: DataroomItem[] }
  | { kind: "copy"; items: DataroomItem[] }
  | { kind: "delete"; items: DataroomItem[]; permanent: boolean }
  | { kind: "share"; item: DataroomItem | null }
  | { kind: "preview"; item: DataroomItem }
  | { kind: "access"; item: DataroomItem }
  | { kind: "permissions"; item: DataroomItem }
  | null;

const VIEWS: { key: DriveView; label: string; icon: typeof HardDrive }[] = [
  { key: "", label: "Drive saya", icon: HardDrive },
  { key: "shared", label: "Dibagikan ke saya", icon: Users },
  { key: "starred", label: "Berbintang", icon: Star },
  { key: "recent", label: "Terbaru", icon: Clock },
  { key: "trash", label: "Sampah", icon: Trash2 },
];

const EMPTY_TEXT: Record<DriveView, string> = {
  "": "Folder ini masih kosong. Tarik file atau folder ke sini, atau klik kanan untuk membuat folder / upload.",
  shared: "Belum ada item yang dibagikan langsung ke Anda.",
  starred: "Belum ada item berbintang. Klik kanan sebuah item lalu pilih Beri bintang.",
  recent: "Belum ada file yang Anda buka.",
  trash: "Sampah kosong. Item di sampah dihapus otomatis setelah 30 hari.",
};

function useDebounced(value: string, ms: number) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return out;
}

export function DataroomPage() {
  const router = useRouter();
  const params = useSearchParams();
  const folderId = params.get("folder") || null;
  const view = (params.get("view") || "") as DriveView;
  const tag = params.get("tag") || "";
  const fileParam = params.get("file") || null;

  const queryClient = useQueryClient();
  const listingQuery = useDataroomListing(folderId, view);
  const listing = listingQuery.data;
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 300);
  const searching = debounced.length > 0 || tag.length > 0;
  const searchQuery = useDataroomSearch(debounced, tag);
  const tagsQuery = useDataroomTags();
  const linkedNode = useDataroomNode(fileParam);
  const error = listingQuery.isError ? listingQuery.error.message || "Gagal memuat Dataroom" : searchQuery.isError ? searchQuery.error.message : null;

  const [viewMode, changeViewMode] = useViewMode();
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | "root" | "area" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<DataroomItem | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  const reload = useCallback(() => queryClient.invalidateQueries({ queryKey: dataroomKeys.all }), [queryClient]);
  const onUploaded = useCallback(
    (parentId: string | null) => {
      void queryClient.invalidateQueries({ queryKey: dataroomKeys.listing(parentId) });
      void queryClient.invalidateQueries({ queryKey: dataroomKeys.tree });
    },
    [queryClient]
  );
  const uploadOptions = useMemo(() => ({ maxFileBytes: listing?.usage.max_file ?? DATAROOM_MAX_FILE_BYTES }), [listing?.usage.max_file]);
  const { tasks, enqueue, enqueueEntries, enqueueVersion, clearFinished } = useUploadQueue(onUploaded, uploadOptions);

  const perms = listing?.permissions ?? { create: false, update: false, delete: false, manage_access: false, level: "" as const };
  const canWriteHere = view === "" && atLeast(perms.level, "editor");
  const items = useMemo(() => {
    const base = searching ? searchQuery.data ?? [] : listing?.items ?? [];
    return sortItems(base, sort.key, sort.dir);
  }, [searching, searchQuery.data, listing, sort]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  // ?file= dari link notifikasi membuka panel detail sampai pengguna memilih item lain.
  const activeDetailId = detailId ?? fileParam;
  const detailItem = useMemo(
    () => items.find((i) => i.id === activeDetailId) ?? (linkedNode.data && linkedNode.data.id === activeDetailId ? linkedNode.data : null),
    [items, activeDetailId, linkedNode.data]
  );
  const currentUserId = listing?.actor?.user_id ?? null;

  // ── Navigasi ────────────────────────────────────────────────────────────
  const navigate = (next: { folder?: string | null; view?: DriveView; tag?: string; file?: string | null }) => {
    const p = new URLSearchParams();
    const f = next.folder === undefined ? folderId : next.folder;
    const v = next.view === undefined ? view : next.view;
    const t = next.tag === undefined ? tag : next.tag;
    if (v) p.set("view", v);
    else if (f) p.set("folder", f);
    if (t) p.set("tag", t);
    if (next.file) p.set("file", next.file);
    const qs = p.toString();
    router.push(qs ? `/dashboard/dataroom?${qs}` : "/dashboard/dataroom");
  };
  const openFolder = (id: string | null) => {
    setSelected(new Set());
    setSearch("");
    setDetailId(null);
    navigate({ folder: id, view: "", tag: "" });
  };
  const openView = (v: DriveView) => {
    setSelected(new Set());
    setSearch("");
    setDetailId(null);
    navigate({ folder: null, view: v, tag: "" });
  };

  // ── Aksi ────────────────────────────────────────────────────────────────
  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      setDialog(null);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setBusy(false);
    }
  };
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("{n}", String(n)));

  const createFolder = (name: string) =>
    run(() => apiPost("/api/dataroom/nodes", { name, parent_id: folderId }).then(() => undefined), "Folder dibuat");
  const rename = (item: DataroomItem, name: string) =>
    run(() => apiPatch(`/api/dataroom/nodes/${item.id}`, { name }).then(() => undefined), "Nama diubah");
  const moveItems = (targets: DataroomItem[], parentId: string | null) =>
    run(async () => {
      for (const it of targets) await apiPatch(`/api/dataroom/nodes/${it.id}`, { parent_id: parentId });
      setSelected(new Set());
    }, plural(targets.length, "Item dipindahkan", "{n} item dipindahkan"));
  const copyItems = (targets: DataroomItem[], parentId: string | null) =>
    run(async () => {
      for (const it of targets) await apiPost(`/api/dataroom/nodes/${it.id}/copy`, { parent_id: parentId });
      setSelected(new Set());
    }, plural(targets.length, "Item disalin", "{n} item disalin"));
  const trashItems = (targets: DataroomItem[]) =>
    run(async () => {
      for (const it of targets) await apiDelete(`/api/dataroom/nodes/${it.id}`);
      setSelected(new Set());
      if (targets.some((t) => t.id === detailId)) setDetailId(null);
    }, plural(targets.length, "Item dipindahkan ke sampah", "{n} item dipindahkan ke sampah"));
  const purgeItems = (targets: DataroomItem[]) =>
    run(async () => {
      for (const it of targets) await apiDelete(`/api/dataroom/nodes/${it.id}/purge`);
      setSelected(new Set());
    }, plural(targets.length, "Item dihapus permanen", "{n} item dihapus permanen"));
  const restoreItems = (targets: DataroomItem[]) =>
    run(async () => {
      for (const it of targets) await apiPost(`/api/dataroom/nodes/${it.id}/restore`, {});
      setSelected(new Set());
    }, plural(targets.length, "Item dipulihkan", "{n} item dipulihkan"));
  const starItems = (targets: DataroomItem[], on: boolean) =>
    run(async () => {
      for (const it of targets) {
        if (on) await apiPut(`/api/dataroom/nodes/${it.id}/star`, {});
        else await apiDelete(`/api/dataroom/nodes/${it.id}/star`);
      }
    }, on ? "Bintang diberikan" : "Bintang dihapus");
  const toggleLock = (item: DataroomItem) =>
    run(async () => {
      if (item.locked_by) await apiDelete(`/api/dataroom/nodes/${item.id}/lock`);
      else await apiPost(`/api/dataroom/nodes/${item.id}/lock`, {});
    }, item.locked_by ? "Kunci dibuka" : "File dikunci untuk Anda edit");

  const download = (item: DataroomItem) => startDownload(nodeFileUrl(item.id));
  const openItem = (item: DataroomItem) => {
    if (view === "trash") { setDetailId(item.id); return; }
    if (item.kind === "folder") openFolder(item.id);
    else if (canPreview(item.mime)) setDialog({ kind: "preview", item });
    else download(item);
  };
  const pickVersion = (item: DataroomItem) => {
    versionTarget.current = item;
    versionInput.current?.click();
  };

  // ── Menu klik kanan (entri dihitung saat event, bukan saat render) ──────
  const entriesFor = (item: DataroomItem | null): MenuEntry[] => {
    if (!item) {
      return [
        { key: "new-folder", label: "Folder baru", icon: <FolderPlus />, disabled: !canWriteHere, onSelect: () => setDialog({ kind: "new-folder" }) },
        { key: "upload", label: "Upload file", icon: <Upload />, disabled: !canWriteHere, onSelect: () => fileInput.current?.click() },
        { key: "upload-folder", label: "Upload folder", icon: <FolderUp />, disabled: !canWriteHere, onSelect: () => folderInput.current?.click() },
        { key: "reload", label: "Muat ulang", icon: <RefreshCw />, separatorBefore: true, onSelect: () => void reload() },
      ];
    }
    const group = selected.has(item.id) && selectedItems.length > 1 ? selectedItems : [item];
    const many = group.length > 1;
    const editor = atLeast(item.my_level, "editor");
    const owner = atLeast(item.my_level, "owner");
    if (view === "trash") {
      return [
        { key: "restore", label: many ? `Pulihkan ${group.length} item` : "Pulihkan", icon: <RotateCcw />, disabled: !editor, onSelect: () => restoreItems(group) },
        { key: "detail", label: "Detail", icon: <Info />, onSelect: () => setDetailId(item.id) },
        { key: "purge", label: many ? `Hapus permanen ${group.length} item` : "Hapus permanen", icon: <Trash2 />, danger: true, separatorBefore: true, disabled: !owner || !perms.delete, onSelect: () => setDialog({ kind: "delete", items: group, permanent: true }) },
      ];
    }
    return [
      ...(item.kind === "folder"
        ? [{ key: "open", label: "Buka", icon: <FolderOpen />, onSelect: () => openFolder(item.id) }]
        : [
            ...(canPreview(item.mime) ? [{ key: "preview", label: "Pratinjau", icon: <Eye />, onSelect: () => setDialog({ kind: "preview", item }) }] : []),
            { key: "download", label: many ? `Unduh ${group.filter((g) => g.kind === "file").length} file` : "Unduh", icon: <Download />, onSelect: () => group.filter((g) => g.kind === "file").forEach(download) },
          ]),
      { key: "detail", label: "Detail, versi & komentar", icon: <Info />, onSelect: () => setDetailId(item.id) },
      { key: "star", label: item.starred ? "Hapus bintang" : "Beri bintang", icon: item.starred ? <StarOff /> : <Star />, onSelect: () => starItems(group, !item.starred) },
      { key: "share", label: "Bagikan lewat link", icon: <Share2 />, separatorBefore: true, disabled: !editor, onSelect: () => setDialog({ kind: "share", item }) },
      { key: "permissions", label: "Hak akses pengguna", icon: <Shield />, onSelect: () => setDialog({ kind: "permissions", item }) },
      ...(item.kind === "folder" && perms.manage_access
        ? [{ key: "access", label: "Atur akses departemen", icon: <Building2 />, onSelect: () => setDialog({ kind: "access", item }) }]
        : []),
      ...(item.kind === "file"
        ? [
            { key: "version", label: "Unggah versi baru", icon: <Upload />, separatorBefore: true, disabled: !editor || many, onSelect: () => pickVersion(item) },
            { key: "lock", label: item.locked_by ? "Buka kunci" : "Kunci untuk diedit", icon: item.locked_by ? <Unlock /> : <Lock />, disabled: !editor || many, onSelect: () => toggleLock(item) },
          ]
        : []),
      { key: "rename", label: "Ganti nama", icon: <Pencil />, separatorBefore: item.kind === "folder", disabled: !editor || many, onSelect: () => setDialog({ kind: "rename", item }) },
      { key: "move", label: many ? `Pindahkan ${group.length} item…` : "Pindahkan ke…", icon: <FolderInput />, disabled: !editor, onSelect: () => setDialog({ kind: "move", items: group }) },
      { key: "copy", label: many ? `Salin ${group.length} item…` : "Salin ke…", icon: <Copy />, disabled: !perms.create, onSelect: () => setDialog({ kind: "copy", items: group }) },
      { key: "delete", label: many ? `Hapus ${group.length} item` : "Hapus", icon: <Trash2 />, danger: true, separatorBefore: true, disabled: !editor || !perms.delete, onSelect: () => setDialog({ kind: "delete", items: group, permanent: false }) },
    ];
  };

  const onContextMenu = (e: MouseEvent, item: DataroomItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (item && !selected.has(item.id)) setSelected(new Set([item.id]));
    setMenu({ x: e.clientX, y: e.clientY, entries: entriesFor(item) });
  };

  // ── Seleksi (klik, Ctrl, Shift) dan keyboard ────────────────────────────
  const selectRange = (fromId: string | null, toId: string) => {
    const a = fromId ? items.findIndex((i) => i.id === fromId) : -1;
    const b = items.findIndex((i) => i.id === toId);
    if (a < 0 || b < 0) return new Set([toId]);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return new Set(items.slice(lo, hi + 1).map((i) => i.id));
  };
  const onItemClick = (e: MouseEvent, item: DataroomItem) => {
    e.stopPropagation();
    setFocusedId(item.id);
    if (e.shiftKey) { setSelected(selectRange(anchorId, item.id)); return; }
    setAnchorId(item.id);
    setSelected((prev) => {
      const next = e.metaKey || e.ctrlKey ? new Set(prev) : new Set<string>();
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };
  const gridColumns = () => {
    if (viewMode === "list") return 1;
    const grid = listRef.current?.querySelector<HTMLElement>('[role="listbox"]');
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
  };
  const focusIndex = (index: number) => {
    const target = items[index];
    if (!target) return;
    setFocusedId(target.id);
    listRef.current?.querySelector<HTMLElement>(`[data-item-id="${target.id}"]`)?.focus();
  };
  const onItemKeyDown = (e: KeyboardEvent, item: DataroomItem, index: number) => {
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next = moveFocus(index, e.key, items.length, gridColumns());
      focusIndex(next);
      const target = items[next];
      if (target && e.shiftKey) setSelected(selectRange(anchorId ?? item.id, target.id));
      else if (target) { setSelected(new Set([target.id])); setAnchorId(target.id); }
      return;
    }
    switch (e.key) {
      case "Enter": e.preventDefault(); openItem(item); break;
      case " ":
        e.preventDefault();
        setSelected((prev) => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; });
        break;
      case "Delete":
      case "Backspace": {
        const group = selected.has(item.id) ? selectedItems : [item];
        if (view === "trash") { if (atLeast(item.my_level, "owner")) setDialog({ kind: "delete", items: group, permanent: true }); }
        else if (atLeast(item.my_level, "editor") && perms.delete) setDialog({ kind: "delete", items: group, permanent: false });
        break;
      }
      case "F2": if (atLeast(item.my_level, "editor") && view !== "trash") setDialog({ kind: "rename", item }); break;
      case "Escape": setSelected(new Set()); setMenu(null); break;
      case "a":
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); setSelected(new Set(items.map((i) => i.id))); }
        break;
      default:
        if (e.shiftKey && e.key === "F10") { onContextMenu(e as unknown as MouseEvent, item); }
    }
  };

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const onDragStart = (e: DragEvent, item: DataroomItem) => {
    const ids = selected.has(item.id) ? [...selected] : [item.id];
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    e.dataTransfer.setData(DND_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const hasNodes = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(DND_MIME);

  const allowDrop = (e: DragEvent, target: string | "root" | "area") => {
    if (view !== "" || (!perms.create && !perms.update)) return;
    if (!hasFiles(e) && !hasNodes(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "move";
    if (dropTarget !== target) setDropTarget(target);
  };

  const handleDrop = (e: DragEvent, target: string | "root" | "area") => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    dragDepth.current = 0;
    const parentId = target === "area" ? folderId : target === "root" ? null : target;
    if (hasFiles(e)) {
      if (!perms.create) { toast.error("Anda tidak punya hak mengunggah"); return; }
      const dt = e.dataTransfer;
      void readDroppedEntries(dt).then(async (entries) => {
        const usable = entries.filter((en) => en.file.size > 0 || en.file.type);
        if (usable.length === 0) { toast.error("Tidak ada file yang bisa diunggah"); return; }
        try {
          const folders = await enqueueEntries(usable, parentId);
          if (folders > 0) { toast.success(`${folders} folder dibuat, ${usable.length} file diantrekan`); void reload(); }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Gagal membuat folder");
        }
      });
      return;
    }
    if (hasNodes(e)) {
      if (!perms.update) return;
      let ids: string[] = [];
      try { ids = JSON.parse(e.dataTransfer.getData(DND_MIME)); } catch { ids = []; }
      const targets = items.filter((i) => ids.includes(i.id) && i.id !== target && i.parent_id !== parentId);
      if (targets.length === 0) return;
      moveItems(targets, parentId);
    }
  };

  const onAreaDragEnter = (e: DragEvent) => {
    if (!hasFiles(e) || view !== "") return;
    dragDepth.current += 1;
    setDropTarget((t) => t ?? "area");
  };
  const onAreaDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropTarget(null);
  };

  const clearDropTarget = (id: string) => setDropTarget((t) => (t === id ? null : t));
  const itemUi: ItemInteractions = {
    draggable: perms.update && view === "",
    selected,
    focusedId,
    dropTarget,
    onDragStart,
    onDragOver: allowDrop,
    onDragLeave: clearDropTarget,
    onDrop: handleDrop,
    onClick: onItemClick,
    onOpen: openItem,
    onContextMenu,
    onKeyDown: onItemKeyDown,
    onFocus: (item) => setFocusedId(item.id),
  };

  const usage = listing?.usage;
  const usedPct = usage ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === "asc" ? "desc" : "asc") as SortDir : "asc" }));
  const viewLabel = VIEWS.find((v) => v.key === view)?.label ?? "Drive saya";
  const bulkFiles = selectedItems.filter((i) => i.kind === "file");
  const newMenu = (align: "start" | "end", triggerClass: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90", triggerClass)}>
        <Plus className="h-4 w-4" />Baru
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onClick={() => setDialog({ kind: "new-folder" })}><FolderPlus className="mr-2 h-4 w-4" />Folder baru</DropdownMenuItem>
        <DropdownMenuItem onClick={() => fileInput.current?.click()}><Upload className="mr-2 h-4 w-4" />Upload file</DropdownMenuItem>
        <DropdownMenuItem onClick={() => folderInput.current?.click()}><FolderUp className="mr-2 h-4 w-4" />Upload folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col lg:flex-row" onClick={() => setSelected(new Set())}>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) enqueue(files, folderId); e.target.value = ""; }} />
      <input
        ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          const entries = readPickedEntries(e.target.files ?? []);
          e.target.value = "";
          if (entries.length === 0) return;
          void enqueueEntries(entries, folderId).then((n) => { toast.success(`${n} folder dibuat, ${entries.length} file diantrekan`); void reload(); })
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Gagal membuat folder"));
        }}
      />
      <input ref={versionInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && versionTarget.current) enqueueVersion(f, versionTarget.current); e.target.value = ""; }} />

      {/* Sidebar */}
      <nav aria-label="Tampilan Dataroom" className="border-b bg-muted/30 lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r" onClick={(e) => e.stopPropagation()}>
        <div className="hidden px-4 pt-4 lg:block">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><HardDrive className="h-5 w-5 text-brand-text" />Dataroom</h1>
        </div>
        {perms.create && view === "" && <div className="hidden px-4 pt-3 lg:block">{newMenu("start", "h-9 w-full justify-center")}</div>}
        <ul className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:px-2 lg:py-3">
          {VIEWS.map((v) => (
            <li key={v.key || "drive"}>
              <button
                type="button"
                aria-current={view === v.key && !searching ? "page" : undefined}
                onClick={() => openView(v.key)}
                className={cn("flex w-full items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:bg-muted lg:rounded-lg", view === v.key && !searching && "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <v.icon className="h-4 w-4" />{v.label}
              </button>
            </li>
          ))}
        </ul>
        {(tagsQuery.data ?? []).length > 0 && (
          <div className="hidden px-3 pb-3 lg:block">
            <p className="mb-1 flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground"><Tag className="h-3 w-3" />Tag</p>
            <ul className="flex flex-wrap gap-1">
              {(tagsQuery.data ?? []).slice(0, 20).map((t) => (
                <li key={t.tag}>
                  <button type="button" onClick={() => navigate({ tag: tag === t.tag ? "" : t.tag })} className={cn("rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted", tag === t.tag && "border-primary bg-primary/10 text-brand-text")}>
                    {t.tag} <span className="text-muted-foreground">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {usage && (
          <div className="hidden px-4 pb-4 text-xs lg:block" title={`${formatBytes(usage.used)} dari ${formatBytes(usage.quota)}`}>
            <div className="mb-1 flex justify-between text-muted-foreground"><span>Penyimpanan</span><span>{Math.round(usedPct)}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Pemakaian penyimpanan">
              <div className={cn("h-full rounded-full", usedPct > 90 ? "bg-destructive" : usedPct > 70 ? "bg-amber-500" : "bg-primary")} style={{ width: `${usedPct}%` }} />
            </div>
            <p className="mt-1 text-muted-foreground">{formatBytes(usage.used)} dari {formatBytes(usage.quota)}</p>
          </div>
        )}
      </nav>

      {/* Konten */}
      <div
        className="flex min-w-0 flex-1 flex-col"
        onDragEnter={onAreaDragEnter}
        onDragLeave={onAreaDragLeave}
        onDragOver={(e) => allowDrop(e, "area")}
        onDrop={(e) => handleDrop(e, "area")}
        onContextMenu={(e) => onContextMenu(e, null)}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
          <h1 className="flex items-center gap-2 text-lg font-semibold lg:hidden"><HardDrive className="h-5 w-5 text-brand-text" />Dataroom</h1>
          <div className="relative min-w-[200px] flex-1" onClick={(e) => e.stopPropagation()}>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, deskripsi, tag, isi PDF/DOCX/XLSX" className="h-9 pl-8 pr-8" aria-label="Cari di Dataroom" />
            {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="Hapus pencarian"><X className="h-4 w-4" /></button>}
          </div>
          {listing?.actor && !listing.actor.is_admin && (
            <p className="hidden text-xs text-muted-foreground xl:block">Departemen Anda: <span className="font-medium">{listing.actor.department_name ?? "belum terdaftar di HRIS"}</span></p>
          )}
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setDialog({ kind: "share", item: null }); }}>
            <Link2 className="mr-1.5 h-4 w-4" />Link dibagikan
          </Button>
          {perms.create && view === "" && <div className="lg:hidden" onClick={(e) => e.stopPropagation()}>{newMenu("end", "h-8")}</div>}
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Mode tampilan" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => changeViewMode("grid")} aria-pressed={viewMode === "grid"} className={cn("rounded p-1", viewMode === "grid" ? "bg-muted" : "text-muted-foreground")} title="Tampilan kotak" aria-label="Tampilan kotak"><LayoutGrid className="h-4 w-4" /></button>
            <button type="button" onClick={() => changeViewMode("list")} aria-pressed={viewMode === "list"} className={cn("rounded p-1", viewMode === "list" ? "bg-muted" : "text-muted-foreground")} title="Tampilan daftar" aria-label="Tampilan daftar"><List className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Breadcrumb / judul tampilan */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-6">
          <nav aria-label="Lokasi" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            {searching ? (
              <span className="flex items-center gap-2 px-2 py-1 font-medium">
                <Search className="h-4 w-4 text-muted-foreground" />Hasil pencarian{debounced && <> untuk &quot;{debounced}&quot;</>}
                {tag && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-brand-text">#{tag} <button type="button" onClick={() => navigate({ tag: "" })} aria-label="Hapus filter tag">×</button></span>}
              </span>
            ) : view ? (
              <span className="px-2 py-1 font-medium text-brand-text">{viewLabel}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openFolder(null); }}
                  onDragOver={(e) => allowDrop(e, "root")}
                  onDragLeave={() => clearDropTarget("root")}
                  onDrop={(e) => handleDrop(e, "root")}
                  className={cn("rounded-md px-2 py-1 font-medium hover:bg-muted", !folderId && "text-brand-text", dropTarget === "root" && "bg-primary/15 ring-2 ring-primary")}
                >
                  Drive saya
                </button>
                {(listing?.ancestors ?? []).map((a, idx, arr) => (
                  <span key={a.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openFolder(a.id); }}
                      onDragOver={(e) => allowDrop(e, a.id)}
                      onDragLeave={() => clearDropTarget(a.id)}
                      onDrop={(e) => handleDrop(e, a.id)}
                      aria-current={idx === arr.length - 1 ? "page" : undefined}
                      className={cn("truncate rounded-md px-2 py-1 hover:bg-muted", idx === arr.length - 1 && "font-medium text-brand-text", dropTarget === a.id && "bg-primary/15 ring-2 ring-primary")}
                    >
                      {a.name}
                    </button>
                  </span>
                ))}
              </>
            )}
          </nav>
          {view === "trash" && <p className="text-xs text-muted-foreground">Item dihapus otomatis 30 hari setelah masuk sampah.</p>}
          {listing?.parent?.locked_by_name && <span className="text-xs text-amber-800"><Lock className="mr-1 inline h-3 w-3" />Sedang diedit oleh {listing.parent.locked_by_name}</span>}
        </div>

        {/* Bilah aksi massal */}
        {selectedItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm sm:px-6" onClick={(e) => e.stopPropagation()} role="toolbar" aria-label="Aksi untuk item terpilih">
            <span className="font-medium">{selectedItems.length} dipilih</span>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded p-1 hover:bg-muted" aria-label="Batalkan pilihan"><X className="h-4 w-4" /></button>
            <span className="mx-1 h-5 w-px bg-border" />
            {view === "trash" ? (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => restoreItems(selectedItems)}><RotateCcw className="mr-1.5 h-4 w-4" />Pulihkan</Button>
                <Button variant="outline" size="sm" className="text-destructive" disabled={busy || !perms.delete} onClick={() => setDialog({ kind: "delete", items: selectedItems, permanent: true })}><Trash2 className="mr-1.5 h-4 w-4" />Hapus permanen</Button>
              </>
            ) : (
              <>
                {bulkFiles.length > 0 && <Button variant="outline" size="sm" onClick={() => bulkFiles.forEach(download)}><Download className="mr-1.5 h-4 w-4" />Unduh</Button>}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => starItems(selectedItems, !selectedItems.every((i) => i.starred))}><Star className="mr-1.5 h-4 w-4" />{selectedItems.every((i) => i.starred) ? "Hapus bintang" : "Bintang"}</Button>
                <Button variant="outline" size="sm" disabled={busy || !perms.update} onClick={() => setDialog({ kind: "move", items: selectedItems })}><FolderInput className="mr-1.5 h-4 w-4" />Pindahkan</Button>
                <Button variant="outline" size="sm" disabled={busy || !perms.create} onClick={() => setDialog({ kind: "copy", items: selectedItems })}><Copy className="mr-1.5 h-4 w-4" />Salin</Button>
                <Button variant="outline" size="sm" className="text-destructive" disabled={busy || !perms.delete} onClick={() => setDialog({ kind: "delete", items: selectedItems, permanent: false })}><Trash2 className="mr-1.5 h-4 w-4" />Hapus</Button>
              </>
            )}
          </div>
        )}

        {/* Isi */}
        <div ref={listRef} className={cn("relative flex-1 p-4 sm:p-6", dropTarget === "area" && "bg-primary/5")}>
          {dropTarget === "area" && (
            <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/70">
              <div className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow"><UploadCloud className="h-5 w-5" />Lepaskan untuk mengunggah ke {listing?.parent?.name ?? "Drive saya"}</div>
            </div>
          )}

          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div>
          ) : (searching ? searchQuery.isPending : !listing) ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 text-center text-sm text-muted-foreground">
              {searching ? <Search className="h-10 w-10" /> : <UploadCloud className="h-10 w-10" />}
              {searching ? "Tidak ada item yang cocok." : EMPTY_TEXT[view]}
            </div>
          ) : viewMode === "grid" ? (
            <ItemGrid items={items} ui={itemUi} showPath={searching || view !== ""} />
          ) : (
            <ItemTable items={items} ui={itemUi} sort={sort} onSort={onSort} showPath={searching || view !== ""} />
          )}
          {view === "trash" && detailItem?.trashed_at && (
            <p className="mt-3 text-xs text-muted-foreground">&quot;{detailItem.name}&quot; dihapus permanen dalam {purgeDaysLeft(detailItem.trashed_at)} hari.</p>
          )}
        </div>
      </div>

      {detailItem && (
        <DetailsPanel
          item={detailItem}
          currentUserId={currentUserId}
          onClose={() => { setDetailId(null); if (fileParam) navigate({ file: null }); }}
          onChanged={() => { void reload(); if (fileParam) void linkedNode.refetch(); }}
          onUploadVersion={enqueueVersion}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}

      {dialog?.kind === "new-folder" && (
        <NameDialog open title="Folder baru" initial="Folder baru" submitLabel="Buat" busy={busy} onClose={() => setDialog(null)} onSubmit={createFolder} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog open title="Ganti nama" initial={dialog.item.name} submitLabel="Simpan" busy={busy} onClose={() => setDialog(null)} onSubmit={(name) => rename(dialog.item, name)} />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog open mode="move" items={dialog.items} busy={busy} onClose={() => setDialog(null)} onSubmit={(target) => moveItems(dialog.items, target)} />
      )}
      {dialog?.kind === "copy" && (
        <MoveDialog open mode="copy" items={dialog.items} busy={busy} onClose={() => setDialog(null)} onSubmit={(target) => copyItems(dialog.items, target)} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog open items={dialog.items} permanent={dialog.permanent} busy={busy} onClose={() => setDialog(null)} onConfirm={() => (dialog.permanent ? purgeItems(dialog.items) : trashItems(dialog.items))} />
      )}
      {dialog?.kind === "access" && (
        <AccessDialog open node={dialog.item} onClose={() => setDialog(null)} onSaved={() => void reload()} />
      )}
      {dialog?.kind === "permissions" && (
        <PermissionsDialog open node={dialog.item} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog open node={dialog.item} canManage={perms.create} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "preview" && (
        <PreviewDialog
          open name={dialog.item.name} mime={dialog.item.mime} size={dialog.item.size_bytes}
          inlineUrl={nodeFileUrl(dialog.item.id, true)}
          downloadUrl={nodeFileUrl(dialog.item.id)}
          textUrl={`/api/dataroom/nodes/${dialog.item.id}/text`}
          onClose={() => setDialog(null)}
        />
      )}

      <UploadPanel tasks={tasks} onClear={clearFinished} />
    </div>
  );
}
