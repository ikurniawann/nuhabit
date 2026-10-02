"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { ApiMessage } from "../types";
import { formatDate } from "../types";
import { ImageUpload } from "./image-upload";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

interface NewsRow {
  id: string;
  title: string;
  category: "news" | "event" | "tips" | "promo";
  summary: string | null;
  body: string | null;
  image_url: string | null;
  status: "draft" | "published";
  pinned: boolean;
  published_at: string | null;
  updated_at: string;
}

export const NEWS_CATEGORY_LABEL: Record<NewsRow["category"], string> = { news: "Berita", event: "Event", tips: "Tips latihan", promo: "Promo" };

export function StudioNewsPage() {
  const [rows, setRows] = useState<NewsRow[] | null>(null);
  const [editing, setEditing] = useState<NewsRow | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await apiGet<{ data: NewsRow[] }>("/api/studio/news")).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat news");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: NewsRow) {
    if (!confirm(`Hapus "${row.title}"?`)) return;
    try {
      const res = (await apiDelete(`/api/studio/news/${row.id}`)) as ApiMessage;
      toast.success(res.message ?? "Dihapus");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus");
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="News Hyrox"
        subtitle="Berita, event, dan tips latihan yang tampil di beranda Member App. Draft tidak terlihat member."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Tulis news
          </Button>
        }
      />

      {!rows ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada news" description="Tulis kabar pertama untuk member — jadwal event, tips latihan, atau info venue." action={<Button onClick={() => setEditing("new")}>Tulis news</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((n) => (
            <div key={n.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {n.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.image_url} alt="" className="aspect-[16/9] w-full object-cover" />
              ) : (
                <div className="aspect-[16/9] w-full bg-nh-forest" />
              )}
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={n.status === "published" ? "positive" : "neutral"}>{n.status === "published" ? "Terbit" : "Draft"}</Pill>
                  <Pill>{NEWS_CATEGORY_LABEL[n.category]}</Pill>
                  {n.pinned && (
                    <Pill tone="brand">
                      <Pin className="mr-1 size-3" /> Disematkan
                    </Pill>
                  )}
                </div>
                <p className="font-display text-base font-semibold text-foreground">{n.title}</p>
                {n.summary && <p className="line-clamp-2 text-sm text-muted-foreground">{n.summary}</p>}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">{n.published_at ? `Terbit ${formatDate(n.published_at.slice(0, 10))}` : "Belum terbit"}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Ubah" onClick={() => setEditing(n)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Hapus" onClick={() => remove(n)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <NewsDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function NewsDialog({ initial, onClose, onSaved }: { initial: NewsRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    category: initial?.category ?? ("news" as NewsRow["category"]),
    summary: initial?.summary ?? "",
    body: initial?.body ?? "",
    image_url: initial?.image_url ?? "",
    status: initial?.status ?? ("draft" as NewsRow["status"]),
    pinned: initial?.pinned ?? false,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(status: NewsRow["status"]) {
    setBusy(true);
    const payload = {
      ...form,
      status,
      title: form.title.trim(),
      summary: form.summary.trim() || null,
      body: form.body.trim() || null,
      image_url: form.image_url || null,
    };
    try {
      const res = initial ? await apiPatch<ApiMessage>(`/api/studio/news/${initial.id}`, payload) : await apiPost<ApiMessage>("/api/studio/news", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Ubah news" : "Tulis news"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Judul" className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Mis. Hyrox Simulation Race bulan ini" />
          </Field>
          <Field label="Kategori">
            <NativeSelect value={form.category} onChange={(e) => set("category", e.target.value as NewsRow["category"])}>
              {Object.entries(NEWS_CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Gambar sampul" hint="Rasio 16:9 paling pas" className="sm:col-span-3">
            <ImageUpload value={form.image_url} onChange={(url) => set("image_url", url)} shape="wide" />
          </Field>
          <Field label="Ringkasan" hint="Tampil di kartu beranda (maks 300 karakter)" className="sm:col-span-3">
            <Textarea rows={2} maxLength={300} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Isi" className="sm:col-span-3">
            <Textarea rows={8} value={form.body} onChange={(e) => set("body", e.target.value)} />
          </Field>
          <label className="flex items-center gap-3 sm:col-span-3">
            <Switch checked={form.pinned} onCheckedChange={(v) => set("pinned", v)} aria-label="Sematkan di atas" />
            <span className="text-sm">Sematkan di urutan teratas</span>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button variant="outline" onClick={() => save("draft")} disabled={busy || form.title.trim().length < 3}>
            {initial?.status === "published" ? "Tarik jadi draft" : "Simpan draft"}
          </Button>
          <Button onClick={() => save("published")} disabled={busy || form.title.trim().length < 3}>
            {busy && <Loader2 className="size-4 animate-spin" />} {initial?.status === "published" ? "Simpan" : "Terbitkan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
