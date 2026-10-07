"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFolderTree, type FolderRow } from "@/features/dataroom/queries";
import type { DataroomItem } from "@/features/dataroom/types";

/** Dialog satu kolom nama: folder baru & ganti nama. Dimount hanya saat dibuka. */
export function NameDialog({ open, title, initial, submitLabel, busy, onClose, onSubmit }: {
  open: boolean; title: string; initial: string; submitLabel: string; busy: boolean;
  onClose: () => void; onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              // Sorot nama tanpa ekstensi (ala Drive) saat ganti nama file
              const dot = e.target.value.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            placeholder="Nama"
            maxLength={255}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NO_FOLDERS: FolderRow[] = [];

/** Dialog "Pindahkan ke": pohon folder; folder sendiri & turunannya dinonaktifkan. */
export function MoveDialog({ open, items, busy, onClose, onSubmit }: {
  open: boolean; items: DataroomItem[]; busy: boolean;
  onClose: () => void; onSubmit: (targetId: string | null) => void;
}) {
  const tree = useFolderTree();
  const folders = tree.isError ? NO_FOLDERS : (tree.data ?? null);
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byParent = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    for (const f of folders ?? []) {
      const list = map.get(f.parent_id) ?? [];
      list.push(f);
      map.set(f.parent_id, list);
    }
    return map;
  }, [folders]);

  // Folder yang dipindahkan + seluruh turunannya tidak boleh jadi tujuan
  const blocked = useMemo(() => {
    const set = new Set<string>();
    const stack = items.filter((i) => i.kind === "folder").map((i) => i.id);
    while (stack.length) {
      const id = stack.pop() as string;
      if (set.has(id)) continue;
      set.add(id);
      for (const child of byParent.get(id) ?? []) stack.push(child.id);
    }
    return set;
  }, [items, byParent]);
  const currentParent = items[0]?.parent_id ?? null;

  const renderTree = (parentId: string | null, depth: number) =>
    (byParent.get(parentId) ?? []).map((f) => {
      const children = byParent.get(f.id) ?? [];
      const isOpen = expanded.has(f.id);
      const disabled = blocked.has(f.id);
      return (
        <div key={f.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSelected(f.id)}
            onDoubleClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
            style={{ paddingLeft: 8 + depth * 18 }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent",
              selected === f.id && "bg-primary/10 text-brand-text"
            )}
          >
            <span
              role="presentation"
              onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }); }}
              className={cn("flex h-4 w-4 items-center justify-center rounded hover:bg-muted", children.length === 0 && "invisible")}
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            <Folder className="h-4 w-4 text-amber-400 fill-amber-300/60" />
            <span className="truncate">{f.name}</span>
            {f.id === currentParent && <span className="ml-auto text-[10px] text-muted-foreground">lokasi saat ini</span>}
          </button>
          {isOpen && renderTree(f.id, depth + 1)}
        </div>
      );
    });

  const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} item`;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pindahkan {label}</DialogTitle></DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border p-1">
          {folders === null ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat folder…</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", selected === null && "bg-primary/10 text-brand-text")}
              >
                <HardDrive className="h-4 w-4 text-muted-foreground" /> Dataroom (root)
                {currentParent === null && <span className="ml-auto text-[10px] text-muted-foreground">lokasi saat ini</span>}
              </button>
              {renderTree(null, 1)}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button
            type="button"
            disabled={busy || selected === undefined || selected === currentParent}
            onClick={() => onSubmit(selected ?? null)}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Pindahkan ke sini
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({ open, items, busy, onClose, onConfirm }: {
  open: boolean; items: DataroomItem[]; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const folders = items.filter((i) => i.kind === "folder").length;
  const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} item`;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Hapus ${label}?`}
      description={
        folders > 0
          ? "Folder beserta seluruh subfolder dan file di dalamnya akan dihapus permanen. Link berbagi yang menunjuk ke item ini ikut mati."
          : "File akan dihapus permanen dari Dataroom. Link berbagi yang menunjuk ke file ini ikut mati."
      }
      confirmLabel="Hapus"
      variant="danger"
      loading={busy}
      onConfirm={onConfirm}
    />
  );
}
