"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/components/iam/iam-access-provider";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { IAM } from "@/lib/iam/prefixes";
import { formatDateTime } from "@/lib/format";
import { INVESTOR_KEYS, investorApi, type ManagedUpdate, type UpdateInput } from "../api";
import { fileSize } from "../format";
import { QueryState } from "./shared";

const EMPTY: UpdateInput = { title: "", body: "" };

/** Investor → Update untuk Investor: direksi menulis, melampirkan dan menerbitkan catatan progres. */
export function InvestorUpdatesEditorPage() {
  const client = useQueryClient();
  const canCreate = useCan(IAM.investorUpdates, "create");
  const canUpdate = useCan(IAM.investorUpdates, "update");
  const canDelete = useCan(IAM.investorUpdates, "delete");
  const list = useQuery({ queryKey: INVESTOR_KEYS.manage, queryFn: investorApi.manage });
  const [editing, setEditing] = useState<ManagedUpdate | "new" | null>(null);
  const [form, setForm] = useState<UpdateInput>(EMPTY);
  const [removing, setRemoving] = useState<ManagedUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: INVESTOR_KEYS.manage });
    void client.invalidateQueries({ queryKey: INVESTOR_KEYS.updates });
    void client.invalidateQueries({ queryKey: INVESTOR_KEYS.documents });
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Permintaan gagal");

  const save = useMutation({
    mutationFn: () => (editing === "new" ? investorApi.create(form) : investorApi.edit((editing as ManagedUpdate).id, form)),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => investorApi.setPublished(id, published),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => investorApi.delete(id),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
    onError: fail,
  });
  const attach = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => investorApi.attach(id, file),
    onSuccess: refresh,
    onError: fail,
  });
  const detach = useMutation({
    mutationFn: ({ id, attachmentId }: { id: string; attachmentId: string }) => investorApi.detach(id, attachmentId),
    onSuccess: refresh,
    onError: fail,
  });

  const open = (u: ManagedUpdate | "new") => {
    setForm(u === "new" ? EMPTY : { title: u.title, body: u.body });
    setEditing(u);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Investor"
        title="Update untuk Investor"
        description="Catatan progres yang dibaca investor di halaman Progres; lampiran muncul di halaman Dokumen."
        actions={
          canCreate && (
            <Button onClick={() => open("new")}>
              <Plus /> Tulis update
            </Button>
          )
        }
      />
      {error && (
        <p role="alert" className="rounded-card bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <QueryState loading={list.isPending} error={list.error} />
      {list.data?.length === 0 && (
        <Card className="py-0">
          <TableNote>Belum ada update. Tulis yang pertama.</TableNote>
        </Card>
      )}
      <ul className="space-y-3" aria-label="Daftar update">
        {(list.data ?? []).map((u) => (
          <li key={u.id}>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{u.title}</h2>
                    <Badge variant={u.status === "published" ? "success" : "muted"}>{u.status === "published" ? "Terbit" : "Draf"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {u.status === "published" && u.published_at ? `Terbit ${formatDateTime(u.published_at)}` : `Diubah ${formatDateTime(u.updated_at)}`}
                    {u.created_by_name ? ` oleh ${u.created_by_name}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canUpdate && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => open(u)}>
                        <Pencil /> Ubah
                      </Button>
                      <Button
                        variant={u.status === "published" ? "soft" : "default"}
                        size="sm"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate({ id: u.id, published: u.status !== "published" })}
                      >
                        {u.status === "published" ? "Tarik ke draf" : "Terbitkan"}
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button variant="destructive" size="sm" onClick={() => setRemoving(u)}>
                      <Trash2 /> Hapus
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-body">{u.body}</p>
              <Attachments update={u} canUpdate={canUpdate} busy={attach.isPending || detach.isPending} onAttach={(file) => attach.mutate({ id: u.id, file })} onDetach={(attachmentId) => detach.mutate({ id: u.id, attachmentId })} />
            </Card>
          </li>
        ))}
      </ul>

      <FormModal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Tulis update" : "Ubah update"}
        description="Tulis untuk investor: apa yang tercapai, apa yang berubah, apa yang berikutnya."
        onSubmit={submit}
        submitLabel="Simpan"
        cancelLabel="Batal"
        loadingLabel="Menyimpan..."
        loading={save.isPending}
        submitDisabled={form.title.trim() === ""}
      >
        <div className="space-y-4">
          <Field label="Judul">
            <Input value={form.title} maxLength={200} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Isi" hint="Teks biasa; baris baru dipertahankan.">
            <Textarea rows={8} value={form.body} maxLength={20000} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
        </div>
      </FormModal>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Hapus update?"
        description={removing ? `"${removing.title}" beserta lampirannya akan dihapus dan tidak bisa dikembalikan.` : undefined}
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

/** Lampiran satu update dengan unggah dan hapus. */
function Attachments({
  update,
  canUpdate,
  busy,
  onAttach,
  onDetach,
}: {
  update: ManagedUpdate;
  canUpdate: boolean;
  busy: boolean;
  onAttach: (file: File) => void;
  onDetach: (attachmentId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-2" aria-label={`Lampiran ${update.title}`}>
        {update.attachments.map((a) => (
          <li key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <Paperclip className="size-3.5" aria-hidden />
            <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-forest hover:underline">
              {a.name}
            </a>
            <span className="text-muted-foreground">({fileSize(a.size_bytes)})</span>
            {canUpdate && (
              <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:text-danger" disabled={busy} onClick={() => onDetach(a.id)}>
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Hapus lampiran {a.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {canUpdate && (
        <div className="mt-2">
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.pptx,.csv"
            aria-label={`Pilih lampiran untuk ${update.title}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttach(file);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <Paperclip /> Tambah lampiran
          </Button>
          <span className="ml-2 text-xs text-muted-foreground">PDF, gambar, dokumen Office atau CSV, maksimal 10 MB.</span>
        </div>
      )}
    </div>
  );
}
