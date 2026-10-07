"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Globe, Plus } from "lucide-react";
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
import { formatDateTime, formatNumber } from "@/lib/format";
import type { PublishStatus, SiteEvent } from "../types";
import { siteAdminApi, type EventInput } from "./api";
import { ImageUrlField, LabeledField, LongText } from "./fields";

const KEY = ["site", "events"];

interface Form {
  title: string;
  slug: string;
  starts_at: string;
  ends_at: string;
  location_text: string;
  cover_image_url: string;
  body_md: string;
  form_slug: string;
  status: PublishStatus;
}

const EMPTY: Form = { title: "", slug: "", starts_at: "", ends_at: "", location_text: "", cover_image_url: "", body_md: "", form_slug: "", status: "draft" };

/** ISO to the value of a datetime-local input, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

function toForm(e: SiteEvent): Form {
  return {
    title: e.title,
    slug: e.slug,
    starts_at: toLocalInput(e.starts_at),
    ends_at: toLocalInput(e.ends_at),
    location_text: e.location_text ?? "",
    cover_image_url: e.cover_image_url ?? "",
    body_md: e.body_md,
    form_slug: e.form_slug ?? "",
    status: e.status,
  };
}

function toInput(f: Form): EventInput {
  return {
    title: f.title.trim(),
    slug: f.slug.trim() || undefined,
    starts_at: toIso(f.starts_at) ?? undefined,
    ends_at: toIso(f.ends_at),
    location_text: f.location_text.trim() || null,
    cover_image_url: f.cover_image_url.trim() || null,
    body_md: f.body_md,
    form_slug: f.form_slug.trim() || null,
    status: f.status,
  };
}

const SELECT = "h-10 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest/40";

/** Situs → Event: public events at /events/[slug], optionally with a CRM form. */
export function EventsPage() {
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: KEY, queryFn: siteAdminApi.events });
  const [editing, setEditing] = useState<SiteEvent | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [deleting, setDeleting] = useState<SiteEvent | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const open = (target: SiteEvent | "new") => {
    setForm(target === "new" ? EMPTY : toForm(target));
    setEditing(target);
  };

  const save = useMutation({
    mutationFn: () => (editing === "new" || !editing ? siteAdminApi.createEvent(toInput(form)) : siteAdminApi.updateEvent(editing.id, toInput(form))),
    onSuccess: (e) => {
      toast.success("Event disimpan", { description: e.title });
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error("Event gagal disimpan", { description: error.message }),
  });
  const toggle = useMutation({
    mutationFn: (e: SiteEvent) => siteAdminApi.updateEvent(e.id, { status: e.status === "published" ? "draft" : "published" }),
    onSuccess: (e) => {
      toast.success(e.status === "published" ? "Event tayang" : "Event jadi draf", { description: e.title });
      refresh();
    },
    onError: (error) => toast.error("Status gagal diubah", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => siteAdminApi.deleteEvent(id),
    onSuccess: () => {
      toast.success("Event dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("Event gagal dihapus", { description: error.message }),
  });

  const rows = events.data ?? [];
  const published = rows.filter((e) => e.status === "published").length;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Situs"
        title="Event"
        description="Event publik di situs. Isi slug form CRM untuk menampilkan formulir pendaftaran di halaman event."
        actions={
          <Button onClick={() => open("new")}>
            <Plus /> Event baru
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <StatCard label="Tayang" value={formatNumber(published)} icon={<Globe />} tone="ink" />
        <StatCard label="Draf" value={formatNumber(rows.length - published)} icon={<CalendarDays />} />
      </div>

      <Card className="py-0">
        {events.isLoading ? (
          <TableNote>Memuat event…</TableNote>
        ) : events.error ? (
          <TableNote tone="danger">{events.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada event. Klik Event baru untuk membuat yang pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Mulai</TableHead>
                <TableHead className="hidden lg:table-cell">Form</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="max-w-[20rem] whitespace-normal">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{e.location_text ?? `/events/${e.slug}`}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateTime(e.starts_at)}</TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell">{e.form_slug ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={e.status === "published" ? "success" : "muted"}>{e.status === "published" ? "Tayang" : "Draf"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => open(e)}>
                        Ubah
                      </Button>
                      <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(e)}>
                        {e.status === "published" ? "Jadikan draf" : "Tayangkan"}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(e)}>
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
              <DialogPanelTitle>{editing === "new" ? "Event baru" : "Ubah event"}</DialogPanelTitle>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <LabeledField label="Judul">
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
              </LabeledField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LabeledField label="Mulai">
                  <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
                </LabeledField>
                <LabeledField label="Selesai">
                  <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
                </LabeledField>
                <LabeledField label="Slug" hint="Kosongkan untuk dibuat dari judul.">
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="font-mono" />
                </LabeledField>
                <LabeledField label="Lokasi">
                  <Input value={form.location_text} onChange={(e) => setForm({ ...form, location_text: e.target.value })} />
                </LabeledField>
              </div>
              <LabeledField label="Gambar sampul">
                <ImageUrlField value={form.cover_image_url} onChange={(v) => setForm({ ...form, cover_image_url: v })} />
              </LabeledField>
              <LabeledField label="Isi (markdown)">
                <LongText value={form.body_md} onChange={(v) => setForm({ ...form, body_md: v })} rows={10} />
              </LabeledField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LabeledField label="Slug form CRM" hint="Formulir publik CRM yang ditanam di halaman event.">
                  <Input value={form.form_slug} onChange={(e) => setForm({ ...form, form_slug: e.target.value })} className="font-mono" placeholder="kontak" />
                </LabeledField>
                <LabeledField label="Status">
                  <select className={SELECT} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
                    <option value="draft">Draf</option>
                    <option value="published">Tayang</option>
                  </select>
                </LabeledField>
              </div>
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
        title="Hapus event?"
        description={deleting ? `"${deleting.title}" akan dihapus dari situs.` : undefined}
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
