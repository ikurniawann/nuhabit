"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEXTAREA } from "@/features/crm/engagement/components/shared";
import { siteAdminApi } from "./api";

/** Shared form controls for the Situs editors and the branch profile dialog. */

export function LabeledField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col">
      <span className="mb-1.5 text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function LongText({ value, onChange, rows = 4 }: { value: string; onChange(v: string): void; rows?: number }) {
  return <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={TEXTAREA} />;
}

/** One line per item. */
export function LinesField({ value, onChange, rows = 4 }: { value: string[]; onChange(v: string[]): void; rows?: number }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <textarea
      rows={rows}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
      }}
      className={TEXTAREA}
    />
  );
}

/** A URL input with an upload button; image URLs get a thumbnail. */
export function ImageUrlField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(value) || value.startsWith("/api/files/");

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      onChange(await siteAdminApi.upload(file));
    } catch (error) {
      toast.error("Upload gagal", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-start gap-2">
      {value && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
          <ImageIcon className="size-4" />
        </span>
      )}
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… atau unggah" className="min-w-0 flex-1" />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <Button type="button" variant="outline" size="icon" aria-label="Unggah gambar" disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 className="animate-spin" /> : <Plus />}
      </Button>
      {value ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Kosongkan" onClick={() => onChange("")}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}

export type ItemKind = "text" | "long" | "url";

export interface ItemField {
  key: string;
  label: string;
  kind: ItemKind;
}

export type Item = Record<string, string>;

export function emptyItem(fields: ItemField[]): Item {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

/** A repeatable list of small objects (benefits, pillars, testimonials). */
export function ItemListField({
  fields,
  items,
  onChange,
  addLabel = "Tambah",
}: {
  fields: ItemField[];
  items: Item[];
  onChange(items: Item[]): void;
  addLabel?: string;
}) {
  const update = (index: number, key: string, value: string) =>
    onChange(items.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Hapus" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <Trash2 className="text-danger" />
            </Button>
          </div>
          {fields.map((f) => (
            <LabeledField key={f.key} label={f.label}>
              {f.kind === "long" ? (
                <LongText value={item[f.key] ?? ""} onChange={(v) => update(index, f.key, v)} rows={3} />
              ) : f.kind === "url" ? (
                <ImageUrlField value={item[f.key] ?? ""} onChange={(v) => update(index, f.key, v)} />
              ) : (
                <Input value={item[f.key] ?? ""} onChange={(e) => update(index, f.key, e.target.value)} />
              )}
            </LabeledField>
          ))}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, emptyItem(fields)])}>
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}
