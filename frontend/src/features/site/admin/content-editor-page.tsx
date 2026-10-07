"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { cn } from "@/lib/utils";
import type { ContentKey } from "../types";
import { siteAdminApi } from "./api";
import { CONTENT_KEYS, CONTENT_SCHEMAS, type SchemaField } from "./content-schemas";
import { ImageUrlField, ItemListField, LabeledField, LinesField, LongText, type Item } from "./fields";

type Value = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function items(v: unknown): Item[] {
  return Array.isArray(v) ? v.map((item) => (item && typeof item === "object" ? (item as Item) : {})) : [];
}

function FieldEditor({ field, value, onChange }: { field: SchemaField; value: unknown; onChange(v: unknown): void }) {
  switch (field.kind) {
    case "text":
      return (
        <LabeledField label={field.label}>
          <Input value={str(value)} onChange={(e) => onChange(e.target.value)} />
        </LabeledField>
      );
    case "long":
      return (
        <LabeledField label={field.label}>
          <LongText value={str(value)} onChange={onChange} rows={field.name.endsWith("_md") ? 12 : 4} />
        </LabeledField>
      );
    case "url":
      return (
        <LabeledField label={field.label}>
          <ImageUrlField value={str(value)} onChange={onChange} />
        </LabeledField>
      );
    case "strings":
      return (
        <LabeledField label={field.label}>
          <LinesField value={Array.isArray(value) ? value.map(str) : []} onChange={onChange} rows={6} />
        </LabeledField>
      );
    case "object": {
      const obj = (value && typeof value === "object" ? value : {}) as Value;
      return (
        <fieldset className="space-y-4 rounded-2xl bg-surface-2 p-4">
          <legend className="px-1 text-sm font-semibold">{field.label}</legend>
          {field.fields.map((f) => (
            <FieldEditor key={f.name} field={f} value={obj[f.name]} onChange={(v) => onChange({ ...obj, [f.name]: v })} />
          ))}
        </fieldset>
      );
    }
    case "objects":
      return (
        <LabeledField label={field.label}>
          <ItemListField fields={field.fields.map((f) => ({ key: f.name, label: f.label, kind: f.kind }))} items={items(value)} onChange={onChange} addLabel={field.addLabel} />
        </LabeledField>
      );
  }
}

function ContentForm({ contentKey }: { contentKey: ContentKey }) {
  const query = useQuery({ queryKey: ["site", "content", contentKey], queryFn: () => siteAdminApi.content(contentKey) });
  if (query.isLoading || !query.data) return <TableNote>Memuat konten…</TableNote>;
  if (query.error) return <TableNote tone="danger">{query.error.message}</TableNote>;
  return <ContentDraft contentKey={contentKey} initial={query.data} />;
}

function ContentDraft({ contentKey, initial }: { contentKey: ContentKey; initial: Value }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Value>(initial);
  const schema = CONTENT_SCHEMAS[contentKey];

  const save = useMutation({
    mutationFn: (value: Value) => siteAdminApi.saveContent(contentKey, value),
    onSuccess: (data) => {
      queryClient.setQueryData(["site", "content", contentKey], data);
      setDraft(data);
      toast.success("Konten disimpan", { description: schema.label });
    },
    onError: (error) => toast.error("Konten gagal disimpan", { description: error.message }),
  });

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <div>
        <h2 className="font-display text-lg font-semibold">{schema.label}</h2>
        <p className="text-sm text-muted-foreground">{schema.description}</p>
      </div>
      {schema.fields.map((field) => (
        <FieldEditor key={field.name} field={field} value={draft[field.name]} onChange={(v) => setDraft({ ...draft, [field.name]: v })} />
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          <Save /> {save.isPending ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>
    </form>
  );
}

/** Situs → Konten: one form per content key of the public site. */
export function ContentEditorPage() {
  const [active, setActive] = useState<ContentKey>("home");
  return (
    <div className="space-y-4">
      <PageHeader kicker="Situs" title="Konten" description="Teks dan gambar halaman publik. Perubahan tampil segera setelah disimpan." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <nav aria-label="Bagian konten" className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
          {CONTENT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              aria-current={active === key ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-left text-sm font-medium transition-colors",
                active === key ? "bg-ink text-on-ink" : "bg-card text-body shadow-card hover:bg-surface-2",
              )}
            >
              {CONTENT_SCHEMAS[key].label}
            </button>
          ))}
        </nav>
        <Card className="py-0">
          <ContentForm key={active} contentKey={active} />
        </Card>
      </div>
    </div>
  );
}
