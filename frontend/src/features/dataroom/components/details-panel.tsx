"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Download, History, Loader2, Lock, MessageSquare, RotateCcw, Send, Trash2, Unlock, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";
import { formatBytes } from "@/lib/dataroom/config";
import { ROLE_LABEL, activityLabel, atLeast } from "@/lib/dataroom/drive";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import {
  dataroomKeys, startDownload, useActivity, useComments, usePeople, useVersions, versionFileUrl,
} from "@/features/dataroom/queries";
import type { CommentRow, DataroomItem, Person } from "@/features/dataroom/types";

/**
 * Panel detail item: deskripsi dan tag, kunci edit, versi file (unggah
 * versi baru, pulihkan, unduh), komentar berutas dengan mention, dan log
 * aktivitas. Dipasang di sisi kanan halaman (overlay di layar kecil).
 */
export function DetailsPanel({ item, currentUserId, onClose, onChanged, onUploadVersion }: {
  item: DataroomItem;
  currentUserId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onUploadVersion: (file: File, node: DataroomItem) => void;
}) {
  const [tab, setTab] = useState("detail");
  const canEdit = atLeast(item.my_level, "editor");
  const canComment = atLeast(item.my_level, "commenter");
  const isOwner = atLeast(item.my_level, "owner");
  return (
    <aside
      aria-label={`Detail ${item.name}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl lg:static lg:z-auto lg:w-[340px] lg:shadow-none"
    >
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" title={item.name}>{item.name}</h2>
          <p className="text-xs text-muted-foreground">
            {item.kind === "file" ? `${formatBytes(item.size_bytes)} · versi ${item.version ?? 1}` : "Folder"} · {ROLE_LABEL[item.my_level ?? ""] ?? "Tanpa hak"}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Tutup panel detail"><X className="h-4 w-4" /></button>
      </div>
      {item.locked_by_name && (
        <p className="flex items-center gap-1.5 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <Lock className="h-3.5 w-3.5" />Sedang diedit oleh {item.locked_by_name}{item.locked_at && <> sejak {formatDateTime(item.locked_at)}</>}
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col">
        <TabsList variant="line" className="shrink-0 px-2">
          <TabsTrigger value="detail">Detail</TabsTrigger>
          {item.kind === "file" && <TabsTrigger value="versions"><History className="mr-1 h-3.5 w-3.5" />Versi</TabsTrigger>}
          <TabsTrigger value="comments"><MessageSquare className="mr-1 h-3.5 w-3.5" />Komentar</TabsTrigger>
          <TabsTrigger value="activity">Aktivitas</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="detail"><DetailTab item={item} canEdit={canEdit} isOwner={isOwner} currentUserId={currentUserId} onChanged={onChanged} /></TabsContent>
          {item.kind === "file" && <TabsContent value="versions"><VersionsTab item={item} canEdit={canEdit} onChanged={onChanged} onUploadVersion={onUploadVersion} /></TabsContent>}
          <TabsContent value="comments"><CommentsTab item={item} canComment={canComment} isOwner={isOwner} currentUserId={currentUserId} /></TabsContent>
          <TabsContent value="activity"><ActivityTab nodeId={item.id} /></TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function DetailTab({ item, canEdit, isOwner, currentUserId, onChanged }: {
  item: DataroomItem; canEdit: boolean; isOwner: boolean; currentUserId: string | null; onChanged: () => void;
}) {
  const [description, setDescription] = useState(item.description ?? "");
  const [tags, setTags] = useState((item.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const dirty = description !== (item.description ?? "") || tags !== (item.tags ?? []).join(", ");

  const save = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/dataroom/nodes/${item.id}`, {
        description: description.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      toast.success("Detail disimpan");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };
  const toggleLock = async () => {
    setBusy(true);
    try {
      if (item.locked_by) await apiDelete(`/api/dataroom/nodes/${item.id}/lock`);
      else await apiPost(`/api/dataroom/nodes/${item.id}/lock`, {});
      toast.success(item.locked_by ? "Kunci dibuka" : "File dikunci untuk Anda edit");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah kunci");
    } finally {
      setBusy(false);
    }
  };
  const lockedByMe = item.locked_by !== null && item.locked_by !== undefined && item.locked_by === currentUserId;

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Pemilik</dt><dd>{item.created_by_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Dibuat</dt><dd>{item.created_at ? formatDateTime(item.created_at) : "—"}</dd>
        <dt className="text-muted-foreground">Diubah</dt><dd>{formatDateTime(item.updated_at)}</dd>
        {item.mime && <><dt className="text-muted-foreground">Jenis</dt><dd className="truncate">{item.mime}</dd></>}
        {item.path && item.path.length > 0 && <><dt className="text-muted-foreground">Lokasi</dt><dd className="truncate">{item.path.map((p) => p.name).join(" / ")}</dd></>}
      </dl>
      <div className="space-y-1">
        <label htmlFor="dataroom-desc" className="text-xs font-medium text-muted-foreground">Deskripsi</label>
        <Textarea id="dataroom-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} maxLength={2000} placeholder="Catatan singkat tentang item ini" />
      </div>
      <div className="space-y-1">
        <label htmlFor="dataroom-tags" className="text-xs font-medium text-muted-foreground">Tag (pisahkan dengan koma)</label>
        <Input id="dataroom-tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canEdit} placeholder="kontrak, 2026, legal" />
        {(item.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {(item.tags ?? []).map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{t}</span>)}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {item.kind === "file" && (
            <Button type="button" variant="outline" size="sm" onClick={toggleLock} disabled={busy || (!!item.locked_by && !lockedByMe && !isOwner)}>
              {item.locked_by ? <><Unlock className="mr-1.5 h-4 w-4" />Buka kunci</> : <><Lock className="mr-1.5 h-4 w-4" />Kunci untuk diedit</>}
            </Button>
          )}
          <Button type="button" size="sm" onClick={save} disabled={busy || !dirty}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
        </div>
      )}
    </div>
  );
}

function VersionsTab({ item, canEdit, onChanged, onUploadVersion }: {
  item: DataroomItem; canEdit: boolean; onChanged: () => void; onUploadVersion: (file: File, node: DataroomItem) => void;
}) {
  const versions = useVersions(item.id);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (versionId: string) => {
    setBusy(versionId);
    try {
      await apiPost(`/api/dataroom/nodes/${item.id}/versions/${versionId}/restore`, {});
      toast.success("Versi dipulihkan");
      void queryClient.invalidateQueries({ queryKey: dataroomKeys.versions(item.id) });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memulihkan versi");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      {canEdit && (
        <>
          <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadVersion(f, item); e.target.value = ""; }} />
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />Unggah versi baru
          </Button>
        </>
      )}
      <p className="text-xs text-muted-foreground">Versi saat ini: {item.version ?? 1} · {formatBytes(item.size_bytes)} · {formatDateTime(item.updated_at)}</p>
      {versions.isError ? (
        <p className="text-xs text-destructive">{versions.error.message}</p>
      ) : !versions.data ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat…</p>
      ) : versions.data.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Belum ada versi sebelumnya.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {versions.data.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">v{v.version}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={v.name}>{v.name}</span>
                <span className="text-muted-foreground">{formatBytes(v.size_bytes)} · {formatDateTime(v.created_at)} · {v.created_by_name ?? "—"}</span>
              </span>
              <button type="button" onClick={() => startDownload(versionFileUrl(item.id, v.id))} className="rounded-md p-1 hover:bg-muted" aria-label={`Unduh versi ${v.version}`}><Download className="h-4 w-4" /></button>
              {canEdit && (
                <button type="button" onClick={() => restore(v.id)} disabled={busy === v.id} className="rounded-md p-1 hover:bg-muted disabled:opacity-50" aria-label={`Pulihkan versi ${v.version}`}>
                  {busy === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentsTab({ item, canComment, isOwner, currentUserId }: { item: DataroomItem; canComment: boolean; isOwner: boolean; currentUserId: string | null }) {
  const comments = useComments(item.id);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const people = usePeople(mentionQuery ?? "");
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: dataroomKeys.comments(item.id) });

  const onBodyChange = (value: string) => {
    setBody(value);
    // "@nama" di akhir teks membuka pemilih pengguna.
    const m = /(?:^|\s)@([^\s@]*)$/.exec(value);
    setMentionQuery(m ? m[1] : null);
  };
  const pickMention = (p: Person) => {
    setBody((b) => b.replace(/@([^\s@]*)$/, `@${p.full_name} `));
    setMentions((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    setMentionQuery(null);
  };
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/dataroom/nodes/${item.id}/comments`, {
        body: body.trim(), parent_id: replyTo?.id ?? null,
        mention_user_ids: mentions.filter((p) => body.includes(`@${p.full_name}`)).map((p) => p.id),
      });
      setBody(""); setReplyTo(null); setMentions([]);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim komentar");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: CommentRow) => {
    try {
      await apiDelete(`/api/dataroom/comments/${c.id}`);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus komentar");
    }
  };

  const roots = (comments.data ?? []).filter((c) => !c.parent_id);
  const replies = (parentId: string) => (comments.data ?? []).filter((c) => c.parent_id === parentId);
  const render = (c: CommentRow, depth: number) => (
    <li key={c.id} className={cn("space-y-1", depth > 0 && "ml-4 border-l pl-3")}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{c.created_by_name ?? "Pengguna"}</span>
        <span className="text-muted-foreground">{formatDateTime(c.created_at)}</span>
        {!c.deleted && canComment && <button type="button" onClick={() => setReplyTo(c)} className="text-brand-text hover:underline">Balas</button>}
        {!c.deleted && (c.created_by === currentUserId || isOwner) && (
          <button type="button" onClick={() => remove(c)} className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label="Hapus komentar"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
      <p className={cn("whitespace-pre-wrap text-sm", c.deleted && "italic text-muted-foreground")}>{c.deleted ? "Komentar dihapus" : c.body}</p>
      {replies(c.id).length > 0 && <ul className="space-y-2">{replies(c.id).map((r) => render(r, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="space-y-3">
      {comments.isError ? (
        <p className="text-xs text-destructive">{comments.error.message}</p>
      ) : !comments.data ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat…</p>
      ) : roots.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Belum ada komentar.</p>
      ) : (
        <ul className="space-y-3">{roots.map((c) => render(c, 0))}</ul>
      )}
      {canComment && (
        <div className="space-y-2 border-t pt-3">
          {replyTo && (
            <p className="flex items-center justify-between text-xs text-muted-foreground">
              Membalas {replyTo.created_by_name ?? "komentar"}
              <button type="button" onClick={() => setReplyTo(null)} className="hover:underline">batal</button>
            </p>
          )}
          <Textarea rows={2} value={body} onChange={(e) => onBodyChange(e.target.value)} placeholder="Tulis komentar; ketik @ untuk menyebut rekan" aria-label="Komentar baru" maxLength={4000} />
          {mentionQuery !== null && (
            <ul className="max-h-36 overflow-y-auto rounded-md border bg-popover text-xs shadow" role="listbox" aria-label="Pilih pengguna untuk disebut">
              {(people.data ?? []).length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Tidak ada pengguna yang cocok.</li>}
              {(people.data ?? []).map((p) => (
                <li key={p.id}><button type="button" onClick={() => pickMention(p)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted"><AtSign className="h-3 w-3" />{p.full_name}</button></li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={submit} disabled={busy || !body.trim()}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Kirim</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ nodeId }: { nodeId: string }) {
  const activity = useActivity(nodeId);
  if (activity.isError) return <p className="text-xs text-destructive">{activity.error.message}</p>;
  if (!activity.data) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat…</p>;
  if (activity.data.length === 0) return <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Belum ada aktivitas.</p>;
  return (
    <ul className="space-y-2 text-xs">
      {activity.data.map((a) => (
        <li key={a.id} className="flex gap-2">
          <span className="w-[6.5rem] shrink-0 text-muted-foreground">{formatDateTime(a.created_at)}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{a.actor_name ?? "Sistem"}</span> {activityLabel(a.action)}
            {a.node_id !== nodeId && a.node_name && <> <span className="truncate text-muted-foreground">{a.node_name}</span></>}
            {typeof a.detail?.version === "number" && <span className="text-muted-foreground"> (v{String(a.detail.version)})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
