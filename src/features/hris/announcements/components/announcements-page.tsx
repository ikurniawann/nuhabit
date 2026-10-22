"use client";

import { useCallback, useEffect, useState } from "react";
import { MegaphoneIcon, PlusIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { RichTextEditor } from "@/components/hris/RichTextEditor";
import { VideoEmbed } from "@/components/hris/VideoEmbed";
import { parseVideoUrl } from "@/lib/hris/announcement-video";
import { ANNOUNCEMENT_TAG_PRESETS } from "@/lib/hris/announcements";

interface Department {
  id: string;
  name: string;
  code: string;
}

interface Announcement {
  id: string;
  title: string;
  body_html: string;
  cover_image_url: string | null;
  video_provider: string | null;
  video_id: string | null;
  tags: string[];
  status: string;
  is_pinned: boolean;
  target_scope: string;
  department_ids: string[];
  publish_at: string | null;
  expires_at: string | null;
  created_by_name: string | null;
  read_count: number;
  created_at: string;
}

const EMPTY_FORM = {
  title: "",
  body_html: "",
  cover_image_url: null as string | null,
  video_url: "",
  tags: [] as string[],
  status: "draft" as "draft" | "published",
  is_pinned: false,
  target_scope: "global" as "global" | "department",
  department_ids: [] as string[],
  publish_at: "",
  expires_at: "",
};
type FormState = typeof EMPTY_FORM;

function coverSrc(path: string | null): string | null {
  return path ? `/api/hris/announcements/cover/${path}` : null;
}

/** ISO (UTC Z) → nilai input datetime-local (waktu lokal). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AnnouncementsPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [list, setList] = useState<Announcement[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // null = tak sedang edit; "new" = buat baru
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    fetch("/api/hris/announcements")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setList(json?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
    fetch("/api/hris/departments")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setDepartments(json?.data ?? []))
      .catch(() => {});
  }, [loadList]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setTagInput("");
    setEditingId("new");
  }

  function startEdit(a: Announcement) {
    setForm({
      title: a.title,
      body_html: a.body_html,
      cover_image_url: a.cover_image_url,
      video_url: a.video_provider && a.video_id
        ? a.video_provider === "youtube"
          ? `https://youtu.be/${a.video_id}`
          : `https://vimeo.com/${a.video_id}`
        : "",
      tags: a.tags ?? [],
      status: a.status as "draft" | "published",
      is_pinned: a.is_pinned,
      target_scope: a.target_scope as "global" | "department",
      department_ids: a.department_ids ?? [],
      publish_at: isoToLocalInput(a.publish_at),
      expires_at: isoToLocalInput(a.expires_at),
    });
    setTagInput("");
    setEditingId(a.id);
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    setForm((f) => (f.tags.includes(tag) ? f : { ...f, tags: [...f.tags, tag] }));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  function toggleDepartment(id: string) {
    setForm((f) => ({
      ...f,
      department_ids: f.department_ids.includes(id)
        ? f.department_ids.filter((d) => d !== id)
        : [...f.department_ids, id],
    }));
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Cover harus berupa gambar", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Ukuran cover maksimal 5 MB", "error");
      return;
    }
    setUploadingCover(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/hris/announcements/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal upload cover");
      setForm((f) => ({ ...f, cover_image_url: json.data.path }));
      showToast("Cover terunggah");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal upload cover", "error");
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleSave() {
    if (!form.title.trim()) {
      showToast("Judul wajib diisi", "error");
      return;
    }
    if (form.video_url.trim() && !parseVideoUrl(form.video_url)) {
      showToast("URL video harus YouTube atau Vimeo yang valid", "error");
      return;
    }
    if (form.target_scope === "department" && form.department_ids.length === 0) {
      showToast("Pilih minimal satu departemen atau ubah target ke global", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body_html: form.body_html,
        cover_image_url: form.cover_image_url,
        video_url: form.video_url.trim() || null,
        tags: form.tags,
        status: form.status,
        is_pinned: form.is_pinned,
        target_scope: form.target_scope,
        department_ids: form.target_scope === "department" ? form.department_ids : [],
        publish_at: localInputToIso(form.publish_at),
        expires_at: localInputToIso(form.expires_at),
      };
      const isNew = editingId === "new";
      const res = await fetch(
        isNew ? "/api/hris/announcements" : `/api/hris/announcements/${editingId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan");
      showToast(json.message || "Tersimpan");
      setEditingId(null);
      loadList();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(a: Announcement) {
    if (!window.confirm(`Hapus pengumuman "${a.title}"?`)) return;
    try {
      const res = await fetch(`/api/hris/announcements/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Gagal menghapus");
      }
      showToast("Pengumuman dihapus");
      loadList();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menghapus", "error");
    }
  }

  // ---- Tampilan editor ----
  if (editingId !== null) {
    const isNew = editingId === "new";
    return (
      <div className="mx-auto max-w-3xl space-y-5 pb-16">
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            {isNew ? "Pengumuman Baru" : "Edit Pengumuman"}
          </h1>
          <Button variant="outline" onClick={() => setEditingId(null)}>
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
          <RichTextEditor
            value={form.body_html}
            onChange={(html) => setForm((f) => ({ ...f, body_html: html }))}
          />
        </Field>

        <Field label="Cover (opsional, JPG/PNG/WebP ≤ 5MB)">
          {form.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc(form.cover_image_url)!}
              alt=""
              className="mb-2 max-h-40 rounded-lg object-cover"
            />
          )}
          <div className="flex items-center gap-2">
            <Input type="file" accept="image/*" onChange={handleCoverChange} disabled={uploadingCover} />
            {uploadingCover && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            {form.cover_image_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, cover_image_url: null }))}
              >
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
          {form.video_url.trim() && parseVideoUrl(form.video_url) && (
            <div className="mt-2">
              <VideoEmbed
                provider={parseVideoUrl(form.video_url)!.provider}
                videoId={parseVideoUrl(form.video_url)!.id}
              />
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
                <button type="button" onClick={() => removeTag(tag)} className="text-pink-400 hover:text-pink-700">
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
                  addTag(tagInput);
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
                onClick={() => addTag(preset)}
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
            onValueChange={(v) => setForm((f) => ({ ...f, target_scope: v as "global" | "department" }))}
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
                      onCheckedChange={() => toggleDepartment(d.id)}
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
            onValueChange={(v) => setForm((f) => ({ ...f, status: v as "draft" | "published" }))}
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
          <Button variant="outline" onClick={() => setEditingId(null)}>
            Batal
          </Button>
          <Button className="bg-pink-600 hover:bg-pink-700" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isNew ? "Simpan" : "Perbarui"}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Tampilan daftar ----
  return (
    <div className="space-y-6 pb-12">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <MegaphoneIcon className="h-6 w-6 text-pink-600" /> Pengumuman
          </h1>
          <p className="text-sm text-gray-500">Kelola pengumuman & informasi perusahaan untuk karyawan</p>
        </div>
        <Button className="bg-pink-600 hover:bg-pink-700" onClick={startCreate}>
          <PlusIcon className="mr-2 h-4 w-4" /> Pengumuman Baru
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
          Belum ada pengumuman. Klik &quot;Pengumuman Baru&quot; untuk membuat.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Judul</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dibaca</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-gray-900">
                      {a.is_pinned && <span title="Disematkan">📌</span>}
                      {a.title}
                    </div>
                    {a.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {a.tags.map((t) => (
                          <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.target_scope === "global"
                      ? "Semua divisi"
                      : `${a.department_ids.length} departemen`}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "published"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {a.status === "published" ? "Terbit" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{a.read_count}×</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(a)} title="Edit">
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(a)}
                        title="Hapus"
                        className="text-red-500 hover:text-red-700"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
