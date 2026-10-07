"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/hris/RichTextEditor";
import { VideoEmbed } from "@/components/hris/VideoEmbed";
import { parseVideoUrl } from "@/lib/hris/announcement-video";
import { ANNOUNCEMENT_TAG_PRESETS } from "@/lib/hris/announcements";
import {
  EMPTY_ANNOUNCEMENT_FORM,
  addTag,
  announcementFormFrom,
  announcementPayload,
  toggleId,
  validateAnnouncementForm,
  type AnnouncementScope,
  type AnnouncementStatus,
} from "@/lib/hris/announcements-view";
import { useSaveAnnouncement, useUploadAnnouncementCover } from "../mutations";
import { useAnnouncementDepartments } from "../queries";
import type { Announcement } from "../types";

const MAX_COVER_BYTES = 5 * 1024 * 1024;

function coverSrc(path: string): string {
  return `/api/hris/announcements/cover/${path}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface AnnouncementEditorProps {
  /** null = pengumuman baru */
  announcement: Announcement | null;
  onClose: () => void;
}

export function AnnouncementEditor({ announcement, onClose }: AnnouncementEditorProps) {
  const [form, setForm] = useState(() =>
    announcement ? announcementFormFrom(announcement) : EMPTY_ANNOUNCEMENT_FORM
  );
  const [tagInput, setTagInput] = useState("");
  const { data: departments = [] } = useAnnouncementDepartments();
  const save = useSaveAnnouncement();
  const upload = useUploadAnnouncementCover();
  const video = parseVideoUrl(form.video_url);

  function pushTag(raw: string) {
    setForm((f) => ({ ...f, tags: addTag(f.tags, raw) }));
    setTagInput("");
  }

  async function handleCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Cover harus berupa gambar");
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      toast.error("Ukuran cover maksimal 5 MB");
      return;
    }
    try {
      const path = await upload.mutateAsync(await readAsDataUrl(file));
      setForm((f) => ({ ...f, cover_image_url: path }));
      toast.success("Cover terunggah");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Gagal upload cover");
    }
  }

  function handleSave() {
    const invalid = validateAnnouncementForm(form);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    save.mutate(
      { payload: announcementPayload(form), id: announcement?.id },
      {
        onSuccess: (res) => {
          toast.success(res.message || "Tersimpan");
          onClose();
        },
        onError: (error) => toast.error(error.message || "Gagal menyimpan"),
      }
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {announcement ? "Edit Pengumuman" : "Pengumuman Baru"}
        </h1>
        <Button variant="outline" onClick={onClose}>
          Kembali
        </Button>
      </div>

      <Field label="Judul">
        <Input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="cth. Libur Idul Fitri 2026"
        />
      </Field>

      <Field label="Isi Pengumuman">
        <RichTextEditor value={form.body_html} onChange={(html) => setForm((f) => ({ ...f, body_html: html }))} />
      </Field>

      <Field label="Cover (opsional, JPG/PNG/WebP ≤ 5MB)">
        {form.cover_image_url && (
          <Image
            src={coverSrc(form.cover_image_url)}
            alt=""
            width={320}
            height={160}
            unoptimized
            className="mb-2 h-auto max-h-40 w-auto rounded-lg object-cover"
          />
        )}
        <div className="flex items-center gap-2">
          <Input type="file" accept="image/*" onChange={handleCoverChange} disabled={upload.isPending} />
          {upload.isPending && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {form.cover_image_url && (
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, cover_image_url: null }))}>
              Hapus
            </Button>
          )}
        </div>
      </Field>

      <Field label="Embed Video (opsional — URL YouTube/Vimeo)">
        <Input
          value={form.video_url}
          onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
          placeholder="https://youtu.be/…"
        />
        {video && (
          <div className="mt-2">
            <VideoEmbed provider={video.provider} videoId={video.id} />
          </div>
        )}
      </Field>

      <Field label="Tag (bisa banyak)">
        <div className="flex flex-wrap gap-1.5">
          {form.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-600"
            >
              {tag}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))}
                className="text-pink-400 hover:text-pink-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                pushTag(tagInput);
              }
            }}
            placeholder="Ketik tag lalu Enter"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ANNOUNCEMENT_TAG_PRESETS.filter((t) => !form.tags.includes(t)).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => pushTag(preset)}
              className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:border-pink-300 hover:text-pink-600"
            >
              + {preset}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Target Pembaca">
        <Select
          value={form.target_scope}
          onValueChange={(v) => setForm((f) => ({ ...f, target_scope: v as AnnouncementScope }))}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Semua divisi (global)</SelectItem>
            <SelectItem value="department">Departemen tertentu</SelectItem>
          </SelectContent>
        </Select>
        {form.target_scope === "department" && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-3">
            {departments.length === 0 ? (
              <p className="col-span-full text-xs text-gray-400">Belum ada data departemen.</p>
            ) : (
              departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.department_ids.includes(d.id)}
                    onCheckedChange={() =>
                      setForm((f) => ({ ...f, department_ids: toggleId(f.department_ids, d.id) }))
                    }
                  />
                  {d.name}
                </label>
              ))
            )}
          </div>
        )}
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tayang mulai (opsional)">
          <Input
            type="datetime-local"
            value={form.publish_at}
            onChange={(e) => setForm((f) => ({ ...f, publish_at: e.target.value }))}
          />
        </Field>
        <Field label="Berakhir (opsional)">
          <Input
            type="datetime-local"
            value={form.expires_at}
            onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.is_pinned}
            onCheckedChange={(v) => setForm((f) => ({ ...f, is_pinned: Boolean(v) }))}
          />
          Sematkan di atas (pin)
        </label>
        <Select
          value={form.status}
          onValueChange={(v) => setForm((f) => ({ ...f, status: v as AnnouncementStatus }))}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Terbitkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button className="bg-pink-600 hover:bg-pink-700" onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : announcement ? "Perbarui" : "Simpan"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
