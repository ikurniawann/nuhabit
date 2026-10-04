"use client";

import { useState } from "react";
import { Building2, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPut } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { useFolderAccess } from "@/features/dataroom/queries";
import type { DataroomItem, DepartmentRef } from "@/features/dataroom/types";

/**
 * Dialog "Atur akses departemen" (super admin): folder terbuka untuk semua,
 * atau hanya departemen tertentu. Berlaku ke seluruh isi folder.
 */
export function AccessDialog({ open, node, onClose, onSaved }: {
  open: boolean; node: DataroomItem; onClose: () => void; onSaved: (departments: DepartmentRef[]) => void;
}) {
  const access = useFolderAccess(node.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ItemIcon kind="folder" mime={null} name={node.name} className="h-5 w-5" />
            <span className="truncate">Akses departemen: {node.name}</span>
          </DialogTitle>
        </DialogHeader>
        {access.data ? (
          <AccessForm
            nodeId={node.id}
            departments={access.data.departments}
            initialSelected={access.data.selectedIds}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : access.isError ? (
          <p className="py-4 text-sm text-destructive">{access.error.message || "Gagal memuat departemen"}</p>
        ) : (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Isi dialog; dimount setelah data siap sehingga state awal diambil langsung dari props. */
function AccessForm({ nodeId, departments, initialSelected, onClose, onSaved }: {
  nodeId: string; departments: DepartmentRef[]; initialSelected: string[];
  onClose: () => void; onSaved: (departments: DepartmentRef[]) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [mode, setMode] = useState<"all" | "some">(() => (initialSelected.length > 0 ? "some" : "all"));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    const ids = mode === "all" ? [] : [...selected];
    if (mode === "some" && ids.length === 0) { toast.error("Pilih minimal satu departemen, atau pilih 'Semua departemen'"); return; }
    setBusy(true);
    try {
      const res = await apiPut<{ data: { departments: DepartmentRef[] } }>(`/api/dataroom/nodes/${nodeId}/access`, { department_ids: ids });
      toast.success(ids.length === 0 ? "Folder terbuka untuk semua departemen" : `Akses dibatasi ke ${ids.length} departemen`);
      onSaved(res.data.departments);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("all")} className={cn("flex items-start gap-2 rounded-lg border p-3 text-left text-sm", mode === "all" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
          <Unlock className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="block font-medium">Semua departemen</span><span className="text-xs text-muted-foreground">Semua pengguna menu Dataroom</span></span>
        </button>
        <button type="button" onClick={() => setMode("some")} className={cn("flex items-start gap-2 rounded-lg border p-3 text-left text-sm", mode === "some" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="block font-medium">Departemen tertentu</span><span className="text-xs text-muted-foreground">Hanya yang dicentang</span></span>
        </button>
      </div>
      {mode === "some" && (
        <div className="max-h-[45vh] overflow-y-auto rounded-md border p-1">
          {departments.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Belum ada departemen di HRIS.</p>
          ) : departments.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" className="h-4 w-4" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <Building2 className="h-4 w-4 text-muted-foreground" />{d.name}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Aturan berlaku untuk seluruh subfolder dan file di dalam folder ini. Super admin selalu bisa membuka semua folder.
        Departemen user diambil dari data karyawan HRIS.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
        <Button type="button" onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
      </div>
    </div>
  );
}
