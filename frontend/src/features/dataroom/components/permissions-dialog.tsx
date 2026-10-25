"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiPut } from "@/lib/api-client";
import { ROLE_LABEL } from "@/lib/dataroom/drive";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { dataroomKeys, usePeople, usePermissions } from "@/features/dataroom/queries";
import type { AccessLevel, DataroomItem, GrantRow } from "@/features/dataroom/types";

/**
 * Dialog hak akses per pengguna / per peran (viewer, commenter, editor,
 * owner). Hak diwariskan ke isi folder; hak di subfolder menimpa hak di
 * atasnya. Hanya pemilik yang bisa mengubah.
 */
const ROLES: AccessLevel[] = ["viewer", "commenter", "editor", "owner"];
const ROLE_CODES = ["super_admin", "admin", "direksi", "hrd", "finance_staff", "purchasing_admin", "purchasing_manager", "purchasing_staff", "warehouse_admin", "warehouse_staff", "pos", "pos_supervisor", "qc_staff", "hiring_manager"];

type Draft = Pick<GrantRow, "subject_type" | "subject_id" | "subject_name" | "role">;

export function PermissionsDialog({ open, node, onClose }: { open: boolean; node: DataroomItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const current = usePermissions(node.id);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ItemIcon kind={node.kind} mime={node.mime} name={node.name} className="h-5 w-5" />
            <span className="truncate">Hak akses: {node.name}</span>
          </DialogTitle>
        </DialogHeader>
        {current.data ? (
          <GrantsForm
            node={node}
            initial={current.data.grants}
            canManage={current.data.can_manage}
            onClose={onClose}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: dataroomKeys.permissions(node.id) });
              void queryClient.invalidateQueries({ queryKey: dataroomKeys.all });
            }}
          />
        ) : current.isError ? (
          <p className="text-sm text-destructive">{current.error.message || "Gagal memuat hak akses"}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GrantsForm({ node, initial, canManage, onClose, onSaved }: {
  node: DataroomItem; initial: GrantRow[]; canManage: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [grants, setGrants] = useState<Draft[]>(initial.map(({ subject_type, subject_id, subject_name, role }) => ({ subject_type, subject_id, subject_name, role })));
  const [q, setQ] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [busy, setBusy] = useState(false);
  const people = usePeople(q.trim());

  const has = (type: string, id: string) => grants.some((g) => g.subject_type === type && g.subject_id === id);
  const add = (draft: Draft) => { if (!has(draft.subject_type, draft.subject_id)) setGrants((g) => [...g, draft]); };
  const setRole = (i: number, role: AccessLevel) => setGrants((g) => g.map((x, j) => (j === i ? { ...x, role } : x)));
  const remove = (i: number) => setGrants((g) => g.filter((_, j) => j !== i));

  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/api/dataroom/nodes/${node.id}/permissions`, { grants: grants.map(({ subject_type, subject_id, role }) => ({ subject_type, subject_id, role })) });
      toast.success("Hak akses disimpan");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan hak akses");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Hak berlaku ke seluruh isi {node.kind === "folder" ? "folder" : "file"} ini. Hak yang diatur di subfolder menimpa hak di atasnya. Pembuat item dan super admin selalu pemilik.
      </p>

      {canManage && (
        <div className="space-y-2 rounded-lg border p-3">
          <label htmlFor="dataroom-grant-person" className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><UserPlus className="h-3.5 w-3.5" />Tambah pengguna</label>
          <Input id="dataroom-grant-person" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau email" />
          {q.trim() && (
            <ul className="max-h-40 overflow-y-auto rounded-md border text-sm" role="listbox" aria-label="Hasil pencarian pengguna">
              {people.data?.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Tidak ada pengguna yang cocok.</li>}
              {(people.data ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={has("user", p.id)}
                    onClick={() => { add({ subject_type: "user", subject_id: p.id, subject_name: p.full_name, role: "viewer" }); setQ(""); }}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
                  >
                    <span className="truncate">{p.full_name}<span className="ml-2 text-xs text-muted-foreground">{p.email ?? p.role}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="dataroom-grant-role" className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Users className="h-3.5 w-3.5" />Tambah peran</label>
            <select id="dataroom-grant-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)} className="h-8 flex-1 rounded-md border bg-background px-2 text-sm">
              <option value="">Pilih peran…</option>
              {ROLE_CODES.filter((c) => !has("role", c)).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" disabled={!roleCode} onClick={() => { add({ subject_type: "role", subject_id: roleCode, subject_name: roleCode, role: "viewer" }); setRoleCode(""); }}>Tambah</Button>
          </div>
        </div>
      )}

      {grants.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Belum ada hak khusus. Akses mengikuti aturan departemen dan menu.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {grants.map((g, i) => (
            <li key={`${g.subject_type}:${g.subject_id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", g.subject_type === "role" ? "bg-violet-100 text-violet-800" : "bg-muted text-muted-foreground")}>
                {g.subject_type === "role" ? "Peran" : "Pengguna"}
              </span>
              <span className="min-w-0 flex-1 truncate">{g.subject_name || g.subject_id}</span>
              {canManage ? (
                <>
                  <select aria-label={`Peran ${g.subject_name}`} value={g.role} onChange={(e) => setRole(i, e.target.value as AccessLevel)} className="h-8 rounded-md border bg-background px-2 text-xs">
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`Hapus hak ${g.subject_name}`}><Trash2 className="h-4 w-4" /></Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[g.role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Shield className="h-3.5 w-3.5" />{canManage ? "Anda pemilik item ini" : "Hanya pemilik yang bisa mengubah"}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Tutup</Button>
          {canManage && (
            <Button type="button" onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
          )}
        </div>
      </div>
    </div>
  );
}
