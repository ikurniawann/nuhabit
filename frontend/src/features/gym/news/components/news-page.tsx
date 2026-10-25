"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, TEXTAREA, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { Can } from "@/components/iam/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import {
  initialNewsForm,
  NEWS_CATEGORY_LABELS,
  NEWS_KEYS,
  newsApi,
  newsState,
  toNewsPayload,
  type NewsArticle,
  type NewsCategory,
  type NewsForm,
  type NewsView,
} from "../api";

const STATE_BADGE = {
  draft: { label: "Draf", variant: "outline" },
  scheduled: { label: "Terjadwal", variant: "info" },
  live: { label: "Terbit", variant: "success" },
} as const;

/** Gym → News Member: berita, event, tips dan promo yang tampil di aplikasi member. */
export function NewsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: NEWS_KEYS.list, queryFn: newsApi.list });
  const [editing, setEditing] = useState<NewsArticle | "new" | null>(null);
  const [deleting, setDeleting] = useState<NewsArticle | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: NEWS_KEYS.list });
  const remove = useMutation({
    mutationFn: (id: string) => newsApi.remove(id),
    onSuccess: () => {
      toast.success("News dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("News gagal dihapus", { description: error.message }),
  });
  const branchName = new Map((query.data?.branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym · News"
        title="News Member"
        description="Berita, event, tips latihan dan promo di tab News aplikasi member. Draf tidak terlihat member; yang disematkan tampil paling atas. Pilih cabang untuk membatasi ke member cabang itu."
        actions={
          <Can menu="gym.news" action="create">
            <Button onClick={() => setEditing("new")}>
              <Plus /> Tulis news
            </Button>
          </Can>
        }
      />
      <Card className="overflow-x-auto py-0">
        {query.isLoading ? (
          <TableNote>Memuat news…</TableNote>
        ) : query.error ? (
          <TableNote tone="danger">{query.error.message}</TableNote>
        ) : (query.data?.news ?? []).length === 0 ? (
          <TableNote>Belum ada news. Tulis yang pertama untuk member.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judul</TableHead>
                <TableHead className="hidden sm:table-cell">Kategori</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Cabang</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data!.news.map((n) => {
                const state = STATE_BADGE[newsState(n)];
                return (
                  <TableRow key={n.id}>
                    <TableCell className="max-w-[22rem] whitespace-normal">
                      <p className="flex items-center gap-1.5 font-medium">
                        {n.pinned && <Pin className="size-3.5 shrink-0 text-forest" aria-label="Disematkan" />}
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.published_at ? formatDateTime(n.published_at) : "Belum terbit"}
                        {n.audience === "both" && " · juga di situs"}
                      </p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{NEWS_CATEGORY_LABELS[n.member_category]}</TableCell>
                    <TableCell>
                      <Badge variant={state.variant}>{state.label}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[14rem] whitespace-normal text-xs md:table-cell">
                      {n.branch_ids.length === 0 ? "Semua cabang" : n.branch_ids.map((id) => branchName.get(id) ?? "Cabang lain").join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Can menu="gym.news" action="update">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(n)} aria-label={`Ubah ${n.title}`}>
                            <Pencil />
                          </Button>
                        </Can>
                        <Can menu="gym.news" action="delete">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            onClick={() => setDeleting(n)}
                            aria-label={`Hapus ${n.title}`}
                          >
                            <Trash2 />
                          </Button>
                        </Can>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && query.data && (
        <NewsDialog
          article={editing === "new" ? null : editing}
          view={query.data}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus news?"
        description={
          deleting?.audience === "both"
            ? `"${deleting.title}" juga terhapus dari situs.`
            : `"${deleting?.title ?? ""}" hilang dari aplikasi member.`
        }
        confirmLabel="Hapus"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function NewsDialog({
  article,
  view,
  onClose,
  onSaved,
}: {
  article: NewsArticle | null;
  view: NewsView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<NewsForm>(() => initialNewsForm(article));
  const set = <K extends keyof NewsForm>(key: K, value: NewsForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () => (article ? newsApi.update(article.id, toNewsPayload(form)) : newsApi.create(toNewsPayload(form))),
    onSuccess: () => {
      toast.success(form.status === "published" ? "News diterbitkan" : "Draf news disimpan", { description: form.title });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("News gagal disimpan", { description: error.message }),
  });
  const cover = useMutation({
    mutationFn: (file: File) => newsApi.uploadCover(file),
    onSuccess: ({ url }) => set("cover_image_url", url),
    onError: (error) => toast.error("Gambar gagal diunggah", { description: error.message }),
  });
  const toggleBranch = (id: string) =>
    set("branch_ids", form.branch_ids.includes(id) ? form.branch_ids.filter((b) => b !== id) : [...form.branch_ids, id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{article ? "Ubah news" : "Tulis news"}</DialogPanelTitle>
            <DialogPanelDescription>Tanggal terbit di masa depan menjadwalkan news; kosongkan untuk terbit saat disimpan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Judul" className="sm:col-span-2">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
            </Field>
            <Field label="Kategori">
              <select
                className={SELECT}
                value={form.member_category}
                onChange={(e) => set("member_category", e.target.value as NewsCategory)}
              >
                {(Object.keys(NEWS_CATEGORY_LABELS) as NewsCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {NEWS_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={SELECT} value={form.status} onChange={(e) => set("status", e.target.value as NewsForm["status"])}>
                <option value="draft">Draf</option>
                <option value="published">Terbit</option>
              </select>
            </Field>
            <Field label="Ringkasan" className="sm:col-span-2" hint="Tampil di daftar news dan kartu beranda.">
              <Input value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} maxLength={500} />
            </Field>
            <Field label="Isi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.body_md} onChange={(e) => set("body_md", e.target.value)} rows={8} />
            </Field>
            <Field label="Gambar sampul" className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                {form.cover_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.cover_image_url} alt="" className="h-16 w-24 rounded-xl object-cover" />
                )}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface">
                  <ImagePlus className="size-4" />
                  {cover.isPending ? "Mengunggah…" : form.cover_image_url ? "Ganti gambar" : "Unggah gambar"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) cover.mutate(file);
                    }}
                  />
                </label>
                {form.cover_image_url && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => set("cover_image_url", "")}>
                    Hapus gambar
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Tanggal terbit">
              <Input type="datetime-local" value={form.published_at} onChange={(e) => set("published_at", e.target.value)} />
            </Field>
            <div className="flex flex-col justify-end gap-3">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={form.pinned} onCheckedChange={(v) => set("pinned", v)} /> Sematkan di atas
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={form.also_on_site} onCheckedChange={(v) => set("also_on_site", v)} /> Tampilkan juga di situs
              </label>
            </div>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Cabang</legend>
              <p className="text-xs text-muted-foreground">Tanpa pilihan: member semua cabang melihatnya.</p>
              <div className="flex flex-wrap gap-2">
                {view.branches.map((b) => {
                  const on = form.branch_ids.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleBranch(b.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                        on ? "bg-forest text-white" : "bg-surface text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!form.title.trim() || save.isPending || cover.isPending}>
              {form.status === "published" ? "Terbitkan" : "Simpan draf"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
