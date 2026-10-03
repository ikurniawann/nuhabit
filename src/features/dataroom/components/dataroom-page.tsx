"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2, ChevronRight, Download, Eye, FolderInput, FolderOpen, FolderPlus, HardDrive, LayoutGrid, Link2,
  List, Loader2, Lock, MoreVertical, Pencil, Plus, RefreshCw, Search, Share2, Trash2, Upload, UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { formatBytes, isPreviewable } from "@/lib/dataroom/config";
import { cn } from "@/lib/utils";
import { AccessDialog } from "@/features/dataroom/components/access-dialog";
import { ContextMenu, type MenuEntry } from "@/features/dataroom/components/context-menu";
import { DeleteDialog, MoveDialog, NameDialog } from "@/features/dataroom/components/dialogs";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { PreviewDialog } from "@/features/dataroom/components/preview-dialog";
import { ShareDialog } from "@/features/dataroom/components/share-dialog";
import { UploadPanel } from "@/features/dataroom/components/upload-panel";
import { useUploadQueue } from "@/features/dataroom/hooks/use-upload-queue";
import { tanggal, type DataroomItem, type DataroomListing } from "@/features/dataroom/types";

/**
 * Dataroom (owner 2026-09-04) — penyimpanan dokumen ala Google Drive:
 * folder/subfolder, upload (tombol / drag & drop dari desktop), pindah item
 * dengan drag & drop ke folder atau breadcrumb, menu klik kanan, pratinjau,
 * dan link berbagi (publik / email, PIN, watermark, masa aktif).
 */

const DND_MIME = "application/x-dataroom-ids";
type ViewMode = "grid" | "list";
type Dialog =
  | { kind: "new-folder" }
  | { kind: "rename"; item: DataroomItem }
  | { kind: "move"; items: DataroomItem[] }
  | { kind: "delete"; items: DataroomItem[] }
  | { kind: "share"; item: DataroomItem | null }
  | { kind: "preview"; item: DataroomItem }
  | { kind: "access"; item: DataroomItem }
  | null;

// Mode tampilan disimpan di localStorage; dibaca lewat external store agar
// render server (grid) dan klien tetap konsisten tanpa setState di effect.
const viewListeners = new Set<() => void>();
function readViewMode(): ViewMode {
  try { return window.localStorage.getItem("dataroom:view") === "list" ? "list" : "grid"; } catch { return "grid"; }
}
function subscribeView(cb: () => void) { viewListeners.add(cb); return () => { viewListeners.delete(cb); }; }
function writeViewMode(mode: ViewMode) {
  try { window.localStorage.setItem("dataroom:view", mode); } catch { /* abaikan */ }
  viewListeners.forEach((cb) => cb());
}

export function DataroomPage() {
  const router = useRouter();
  const params = useSearchParams();
  const folderId = params.get("folder") || null;

  const [listing, setListing] = useState<(DataroomListing & { key: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useSyncExternalStore(subscribeView, readViewMode, () => "grid" as ViewMode);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | "root" | "area" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(() => {
    apiGet<{ data: DataroomListing }>(`/api/dataroom/nodes${folderId ? `?parent=${folderId}` : ""}`)
      .then((res) => { setListing({ ...res.data, key: folderId }); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat Dataroom"));
  }, [folderId]);

  useEffect(() => { load(); }, [load]);

  const onUploaded = useCallback((parentId: string | null) => {
    if (parentId === folderId) load();
  }, [folderId, load]);
  const { tasks, enqueue, clearFinished } = useUploadQueue(onUploaded);

  const loading = !listing || listing.key !== folderId;
  const perms = listing?.permissions ?? { create: false, update: false, delete: false, manage_access: false };
  const items = useMemo(() => {
    const all = listing?.items ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
  }, [listing, search]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  const openFolder = (id: string | null) => {
    setSelected(new Set());
    setSearch("");
    router.push(id ? `/dashboard/dataroom?folder=${id}` : "/dashboard/dataroom");
  };

  const changeView = (mode: ViewMode) => writeViewMode(mode);
  const openFilePicker = () => fileInput.current?.click();

  // ── Aksi ────────────────────────────────────────────────────────────────
  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      setDialog(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setBusy(false);
    }
  };

  const createFolder = (name: string) =>
    run(() => apiPost("/api/dataroom/nodes", { name, parent_id: folderId }).then(() => undefined), "Folder dibuat");
  const rename = (item: DataroomItem, name: string) =>
    run(() => apiPatch(`/api/dataroom/nodes/${item.id}`, { name }).then(() => undefined), "Nama diubah");
  const moveItems = (targets: DataroomItem[], parentId: string | null) =>
    run(async () => {
      for (const it of targets) await apiPatch(`/api/dataroom/nodes/${it.id}`, { parent_id: parentId });
      setSelected(new Set());
    }, targets.length === 1 ? "Item dipindahkan" : `${targets.length} item dipindahkan`);
  const deleteItems = (targets: DataroomItem[]) =>
    run(async () => {
      for (const it of targets) await apiDelete(`/api/dataroom/nodes/${it.id}`);
      setSelected(new Set());
    }, targets.length === 1 ? "Item dihapus" : `${targets.length} item dihapus`);

  const download = (item: DataroomItem) => {
    window.location.assign(`/api/dataroom/nodes/${item.id}/download`);
  };
  const openItem = (item: DataroomItem) => {
    if (item.kind === "folder") openFolder(item.id);
    else if (isPreviewable(item.mime)) setDialog({ kind: "preview", item });
    else download(item);
  };

  // ── Menu klik kanan (entri dihitung saat event, bukan saat render) ──────
  const entriesFor = (item: DataroomItem | null): MenuEntry[] => {
    if (!item) {
      return [
        { key: "new-folder", label: "Folder baru", icon: <FolderPlus />, disabled: !perms.create, onSelect: () => setDialog({ kind: "new-folder" }) },
        { key: "upload", label: "Upload file", icon: <Upload />, disabled: !perms.create, onSelect: openFilePicker },
        { key: "reload", label: "Muat ulang", icon: <RefreshCw />, separatorBefore: true, onSelect: load },
      ];
    }
    const group = selected.has(item.id) && selectedItems.length > 1 ? selectedItems : [item];
    const many = group.length > 1;
    return [
      ...(item.kind === "folder"
        ? [{ key: "open", label: "Buka", icon: <FolderOpen />, onSelect: () => openFolder(item.id) }]
        : [
            ...(isPreviewable(item.mime) ? [{ key: "preview", label: "Pratinjau", icon: <Eye />, onSelect: () => setDialog({ kind: "preview", item }) }] : []),
            { key: "download", label: "Unduh", icon: <Download />, onSelect: () => download(item) },
          ]),
      { key: "share", label: "Bagikan", icon: <Share2 />, separatorBefore: true, onSelect: () => setDialog({ kind: "share", item }) },
      ...(item.kind === "folder" && perms.manage_access
        ? [{ key: "access", label: "Atur akses departemen", icon: <Building2 />, onSelect: () => setDialog({ kind: "access", item }) }]
        : []),
      { key: "rename", label: "Ganti nama", icon: <Pencil />, disabled: !perms.update || many, onSelect: () => setDialog({ kind: "rename", item }) },
      { key: "move", label: many ? `Pindahkan ${group.length} item…` : "Pindahkan ke…", icon: <FolderInput />, disabled: !perms.update, onSelect: () => setDialog({ kind: "move", items: group }) },
      { key: "delete", label: many ? `Hapus ${group.length} item` : "Hapus", icon: <Trash2 />, danger: true, separatorBefore: true, disabled: !perms.delete, onSelect: () => setDialog({ kind: "delete", items: group }) },
    ];
  };

  const onContextMenu = (e: MouseEvent, item: DataroomItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (item && !selected.has(item.id)) setSelected(new Set([item.id]));
    setMenu({ x: e.clientX, y: e.clientY, entries: entriesFor(item) });
  };

  const onItemClick = (e: MouseEvent, item: DataroomItem) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = e.metaKey || e.ctrlKey ? new Set(prev) : new Set<string>();
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
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
    if (!perms.create && !perms.update) return;
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
      const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0 || f.type);
      if (!perms.create) { toast.error("Anda tidak punya hak mengunggah"); return; }
      if (files.length === 0) { toast.error("Tidak ada file yang bisa diunggah (folder dari desktop belum didukung)"); return; }
      enqueue(files, parentId);
      return;
    }
    if (hasNodes(e)) {
      if (!perms.update) return;
      let ids: string[] = [];
      try { ids = JSON.parse(e.dataTransfer.getData(DND_MIME)); } catch { ids = []; }
      const targets = (listing?.items ?? []).filter((i) => ids.includes(i.id) && i.id !== target && i.parent_id !== parentId);
      if (targets.length === 0) return;
      moveItems(targets, parentId);
    }
  };

  const onAreaDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDropTarget((t) => t ?? "area");
  };
  const onAreaDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropTarget(null);
  };

  const usage = listing?.usage;
  const usedPct = usage ? Math.min(100, (usage.used / usage.quota) * 100) : 0;

  return (
    <div
      className="flex h-full min-h-[calc(100vh-4rem)] flex-col"
      onDragEnter={onAreaDragEnter}
      onDragLeave={onAreaDragLeave}
      onDragOver={(e) => allowDrop(e, "area")}
      onDrop={(e) => handleDrop(e, "area")}
      onContextMenu={(e) => onContextMenu(e, null)}
      onClick={() => setSelected(new Set())}
    >
      <input
        ref={fileInput} type="file" multiple hidden
        onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) enqueue(files, folderId); e.target.value = ""; }}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <div className="min-w-[200px] flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5 text-primary" />Dataroom</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Simpan & bagikan dokumen perusahaan. Tarik file ke halaman ini untuk mengunggah.
            {listing?.actor && !listing.actor.is_admin && (
              <> · Departemen Anda: <span className="font-medium">{listing.actor.department_name ?? "belum terdaftar di HRIS"}</span></>
            )}
          </p>
        </div>
        {usage && (
          <div className="w-52 text-xs" title={`${formatBytes(usage.used)} dari ${formatBytes(usage.quota)}`}>
            <div className="mb-1 flex justify-between text-muted-foreground">
              <span>Penyimpanan</span><span>{formatBytes(usage.used)} / {formatBytes(usage.quota)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", usedPct > 90 ? "bg-destructive" : usedPct > 70 ? "bg-amber-500" : "bg-primary")} style={{ width: `${usedPct}%` }} />
            </div>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setDialog({ kind: "share", item: null }); }}>
          <Link2 className="mr-1.5 h-4 w-4" />Link dibagikan
        </Button>
        {perms.create && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus className="h-4 w-4" />Baru
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDialog({ kind: "new-folder" })}><FolderPlus className="mr-2 h-4 w-4" />Folder baru</DropdownMenuItem>
              <DropdownMenuItem onClick={openFilePicker}><Upload className="mr-2 h-4 w-4" />Upload file</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Toolbar: breadcrumb + cari + tampilan */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-6">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openFolder(null); }}
            onDragOver={(e) => allowDrop(e, "root")}
            onDragLeave={() => setDropTarget((t) => (t === "root" ? null : t))}
            onDrop={(e) => handleDrop(e, "root")}
            className={cn("rounded-md px-2 py-1 font-medium hover:bg-muted", !folderId && "text-primary", dropTarget === "root" && "bg-primary/15 ring-2 ring-primary")}
          >
            Dataroom
          </button>
          {(listing?.ancestors ?? []).map((a, idx, arr) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openFolder(a.id); }}
                onDragOver={(e) => allowDrop(e, a.id)}
                onDragLeave={() => setDropTarget((t) => (t === a.id ? null : t))}
                onDrop={(e) => handleDrop(e, a.id)}
                className={cn("truncate rounded-md px-2 py-1 hover:bg-muted", idx === arr.length - 1 && "font-medium text-primary", dropTarget === a.id && "bg-primary/15 ring-2 ring-primary")}
              >
                {a.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} onClick={(e) => e.stopPropagation()} placeholder="Cari di folder ini" className="h-8 w-48 pl-8" />
        </div>
        <div className="flex rounded-md border p-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => changeView("grid")} className={cn("rounded p-1", view === "grid" ? "bg-muted" : "text-muted-foreground")} title="Tampilan kotak"><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" onClick={() => changeView("list")} className={cn("rounded p-1", view === "list" ? "bg-muted" : "text-muted-foreground")} title="Tampilan daftar"><List className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Isi */}
      <div className={cn("relative flex-1 p-4 sm:p-6", dropTarget === "area" && "bg-primary/5")}>
        {dropTarget === "area" && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/70">
            <div className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow"><UploadCloud className="h-5 w-5" />Lepaskan untuk mengunggah ke {listing?.parent?.name ?? "Dataroom"}</div>
          </div>
        )}

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
        ) : loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 text-center text-sm text-muted-foreground">
            <UploadCloud className="h-10 w-10" />
            {search ? "Tidak ada item yang cocok." : "Folder ini masih kosong. Tarik file ke sini, atau klik kanan untuk membuat folder / upload."}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <div
                key={item.id}
                draggable={perms.update}
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={item.kind === "folder" ? (e) => allowDrop(e, item.id) : undefined}
                onDragLeave={item.kind === "folder" ? () => setDropTarget((t) => (t === item.id ? null : t)) : undefined}
                onDrop={item.kind === "folder" ? (e) => handleDrop(e, item.id) : undefined}
                onClick={(e) => onItemClick(e, item)}
                onDoubleClick={() => openItem(item)}
                onContextMenu={(e) => onContextMenu(e, item)}
                className={cn(
                  "group relative flex cursor-default select-none flex-col rounded-xl border bg-card p-3 transition",
                  "hover:border-primary/40 hover:shadow-sm",
                  selected.has(item.id) && "border-primary bg-primary/10",
                  dropTarget === item.id && "border-primary bg-primary/15 ring-2 ring-primary"
                )}
              >
                <div className="flex items-start justify-between">
                  <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-10 w-10" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                    className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100 sm:opacity-0 max-sm:opacity-100"
                    aria-label="Menu"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 line-clamp-2 break-words text-sm font-medium leading-tight" title={item.name}>{item.name}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"} · {tanggal(item.updated_at, false)}
                </p>
                {item.departments && item.departments.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-amber-700" title={item.departments.map((d) => d.name).join(", ")}>
                    <Lock className="h-3 w-3 shrink-0" />
                    <span className="truncate">{item.departments.map((d) => d.name).join(", ")}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nama</th>
                  <th className="px-3 py-2 text-left font-medium">Pemilik</th>
                  <th className="px-3 py-2 text-left font-medium">Diubah</th>
                  <th className="px-3 py-2 text-right font-medium">Ukuran</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    draggable={perms.update}
                    onDragStart={(e) => onDragStart(e, item)}
                    onDragOver={item.kind === "folder" ? (e) => allowDrop(e, item.id) : undefined}
                    onDragLeave={item.kind === "folder" ? () => setDropTarget((t) => (t === item.id ? null : t)) : undefined}
                    onDrop={item.kind === "folder" ? (e) => handleDrop(e, item.id) : undefined}
                    onClick={(e) => onItemClick(e, item)}
                    onDoubleClick={() => openItem(item)}
                    onContextMenu={(e) => onContextMenu(e, item)}
                    className={cn(
                      "cursor-default select-none border-t hover:bg-muted/50",
                      selected.has(item.id) && "bg-primary/10",
                      dropTarget === item.id && "bg-primary/15 ring-2 ring-inset ring-primary"
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-5 w-5 shrink-0" />
                        <span className="truncate">{item.name}</span>
                        {item.departments && item.departments.length > 0 && (
                          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700" title={item.departments.map((d) => d.name).join(", ")}>
                            <Lock className="h-3 w-3" />{item.departments.length === 1 ? item.departments[0].name : `${item.departments.length} departemen`}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.created_by_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{tanggal(item.updated_at)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{item.kind === "file" ? formatBytes(item.size_bytes) : "—"}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Menu"><MoreVertical className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}

      {dialog?.kind === "new-folder" && (
        <NameDialog open title="Folder baru" initial="Folder baru" submitLabel="Buat" busy={busy} onClose={() => setDialog(null)} onSubmit={createFolder} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog open title="Ganti nama" initial={dialog.item.name} submitLabel="Simpan" busy={busy} onClose={() => setDialog(null)} onSubmit={(name) => rename(dialog.item, name)} />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog open items={dialog.items} busy={busy} onClose={() => setDialog(null)} onSubmit={(target) => moveItems(dialog.items, target)} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog open items={dialog.items} busy={busy} onClose={() => setDialog(null)} onConfirm={() => deleteItems(dialog.items)} />
      )}
      {dialog?.kind === "access" && (
        <AccessDialog open node={dialog.item} onClose={() => setDialog(null)} onSaved={() => load()} />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog open node={dialog.item} canManage={perms.create} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "preview" && (
        <PreviewDialog
          open name={dialog.item.name} mime={dialog.item.mime} size={dialog.item.size_bytes}
          inlineUrl={`/api/dataroom/nodes/${dialog.item.id}/download?inline=1`}
          downloadUrl={`/api/dataroom/nodes/${dialog.item.id}/download`}
          onClose={() => setDialog(null)}
        />
      )}

      <UploadPanel tasks={tasks} onClear={clearFinished} />
    </div>
  );
}
