"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Globe, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelForm, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDate, formatNumber } from "@/lib/format";
import { ARTICLE_CATEGORIES, CATEGORY_LABELS, type Article, type ArticleCategory, type PublishStatus } from "../types";
import { siteAdminApi, type ArticleInput } from "./api";
import { ImageUrlField, LabeledField, LongText } from "./fields";

const KEY = ["site", "articles"];

interface Form {
  title: string;
  slug: string;
  category: ArticleCategory;
  excerpt: string;
  cover_image_url: string;
  body_md: string;
  status: PublishStatus;
}

const EMPTY: Form = { title: "", slug: "", category: "news", excerpt: "", cover_image_url: "", body_md: "", status: "draft" };

function toForm(a: Article): Form {
  return { title: a.title, slug: a.slug, category: a.category, excerpt: a.excerpt ?? "", cover_image_url: a.cover_image_url ?? "", body_md: a.body_md, status: a.status };
}

function toInput(f: Form): ArticleInput {
  return {
    title: f.title.trim(),
    slug: f.slug.trim() || undefined,
    category: f.category,
    excerpt: f.excerpt.trim() || null,
    cover_image_url: f.cover_image_url.trim() || null,
    body_md: f.body_md,
    status: f.status,
  };
}

const SELECT = "h-10 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest/40";

/** Situs → Artikel: list and editor of public articles. */
export function ArticlesPage() {
  const queryClient = useQueryClient();
  const articles = useQuery({ queryKey: KEY, queryFn: siteAdminApi.articles });
  const [editing, setEditing] = useState<Article | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [deleting, setDeleting] = useState<Article | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const open = (target: Article | "new") => {
    setForm(target === "new" ? EMPTY : toForm(target));
    setEditing(target);
  };

  const save = useMutation({
    mutationFn: () => (editing === "new" || !editing ? siteAdminApi.createArticle(toInput(form)) : siteAdminApi.updateArticle(editing.id, toInput(form))),
    onSuccess: (a) => {
      toast.success("Artikel disimpan", { description: a.title });
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error("Artikel gagal disimpan", { description: error.message }),
  });
  const toggle = useMutation({
    mutationFn: (a: Article) => siteAdminApi.updateArticle(a.id, { status: a.status === "published" ? "draft" : "published" }),
    onSuccess: (a) => {
      toast.success(a.status === "published" ? "Artikel tayang" : "Artikel jadi draf", { description: a.title });
      refresh();
    },
    onError: (error) => toast.error("Status gagal diubah", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => siteAdminApi.deleteArticle(id),
    onSuccess: () => {
      toast.success("Artikel dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("Artikel gagal dihapus", { description: error.message }),
  });

  const rows = articles.data ?? [];
  const published = rows.filter((a) => a.status === "published").length;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Situs"
        title="Artikel"
        description="Berita, cerita training, event dan rilis apparel di /news. Hanya artikel berstatus tayang yang tampil."
        actions={
          <Button onClick={() => open("new")}>
            <Plus /> Artikel baru
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <StatCard label="Tayang" value={formatNumber(published)} icon={<Globe />} tone="ink" />
        <StatCard label="Draf" value={formatNumber(rows.length - published)} icon={<FileText />} />
      </div>

      <Card className="py-0">
        {articles.isLoading ? (
          <TableNote>Memuat artikel…</TableNote>
        ) : articles.error ? (
          <TableNote tone="danger">{articles.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada artikel. Klik Artikel baru untuk menulis yang pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judul</TableHead>
                <TableHead className="hidden md:table-cell">Kategori</TableHead>
                <TableHead className="hidden md:table-cell">Terbit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-[20rem] whitespace-normal">
                    <p className="font-medium">{a.title}</p>
                    <p className="font-mono text-xs text-muted-foreground">/news/{a.slug}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{CATEGORY_LABELS[a.category]}</TableCell>
                  <TableCell className="hidden md:table-cell">{a.published_at ? formatDate(a.published_at) : "-"}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "published" ? "success" : "muted"}>{a.status === "published" ? "Tayang" : "Draf"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => open(a)}>
                        Ubah
                      </Button>
                      <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>
                        {a.status === "published" ? "Jadikan draf" : "Tayangkan"}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(a)}>
                        Hapus
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogPanel size="lg">
          <DialogPanelForm
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <DialogPanelHeader>
              <DialogPanelTitle>{editing === "new" ? "Artikel baru" : "Ubah artikel"}</DialogPanelTitle>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <LabeledField label="Judul">
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
              </LabeledField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LabeledField label="Slug" hint="Kosongkan untuk dibuat dari judul.">
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="contoh-judul" className="font-mono" />
                </LabeledField>
                <LabeledField label="Kategori">
                  <select className={SELECT} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ArticleCategory })}>
                    {ARTICLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </LabeledField>
              </div>
              <LabeledField label="Ringkasan">
                <LongText value={form.excerpt} onChange={(v) => setForm({ ...form, excerpt: v })} rows={2} />
              </LabeledField>
              <LabeledField label="Gambar sampul">
                <ImageUrlField value={form.cover_image_url} onChange={(v) => setForm({ ...form, cover_image_url: v })} />
              </LabeledField>
              <LabeledField label="Isi (markdown)">
                <LongText value={form.body_md} onChange={(v) => setForm({ ...form, body_md: v })} rows={14} />
              </LabeledField>
              <LabeledField label="Status">
                <select className={SELECT} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
                  <option value="draft">Draf</option>
                  <option value="published">Tayang</option>
                </select>
              </LabeledField>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Menyimpan…" : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus artikel?"
        description={deleting ? `"${deleting.title}" akan dihapus dari situs.` : undefined}
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
