"use client";

import { useEffect, useState } from "react";
import { Building2, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import type { DataroomItem, DepartmentRef } from "@/features/dataroom/types";

/**
 * Dialog "Atur akses departemen" (super admin): folder terbuka untuk semua,
 * atau hanya departemen tertentu. Berlaku ke seluruh isi folder.
 */
export function AccessDialog({ open, node, onClose, onSaved }: {
  open: boolean; node: DataroomItem; onClose: () => void; onSaved: (departments: DepartmentRef[]) => void;
}) {
  const [departments, setDepartments] = useState<DepartmentRef[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [mode, setMode] = useState<"all" | "some">("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      apiGet<{ data: DepartmentRef[] }>("/api/dataroom/departments"),
      apiGet<{ data: { departments: DepartmentRef[] } }>(`/api/dataroom/nodes/${node.id}/access`),
    ])
      .then(([deps, cur]) => {
        setDepartments(deps.data);
        const ids = new Set(cur.data.departments.map((d) => d.id));
        setSelected(ids);
        setMode(ids.size > 0 ? "some" : "all");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Gagal memuat departemen"));
  }, [open, node.id]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev ?? []); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    const ids = mode === "all" ? [] : [...(selected ?? [])];
    if (mode === "some" && ids.length === 0) { toast.error("Pilih minimal satu departemen, atau pilih 'Semua departemen'"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/dataroom/nodes/${node.id}/access`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_ids: ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan");
      toast.success(ids.length === 0 ? "Folder terbuka untuk semua departemen" : `Akses dibatasi ke ${ids.length} departemen`);
      onSaved(json.data.departments);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ItemIcon kind="folder" mime={null} name={node.name} className="h-5 w-5" />
            <span className="truncate">Akses departemen: {node.name}</span>
          </DialogTitle>
        </DialogHeader>
        {departments === null || selected === null ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</p>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
