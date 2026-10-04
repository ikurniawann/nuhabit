"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDef, CustomFieldObject, CustomValues } from "@/lib/crm/custom-fields";
import { useCustomFieldDefs } from "../queries";

interface CustomFieldsSectionProps {
  object: CustomFieldObject;
  values: CustomValues;
  onChange: (next: CustomValues) => void;
  /** grid 2 kolom (default) atau 1 kolom */
  columns?: 1 | 2;
}

/**
 * EPIC-050 T-3.3 — render input custom field sesuai registry. Dipakai di form
 * lead/deal/account/contact; nilai disimpan di `form.custom`.
 */
export function CustomFieldsSection({ object, values, onChange, columns = 2 }: CustomFieldsSectionProps) {
  const defsQuery = useCustomFieldDefs(object);
  const defs = defsQuery.data ?? [];
  if (defs.length === 0) return null;
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });
  return (
    <div className={columns === 2 ? "sm:col-span-2" : ""}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Field tambahan</p>
      <div className={`grid grid-cols-1 gap-4 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
        {defs.map((def) => (
          <CustomFieldInput key={def.id} def={def} value={values[def.key]} onChange={(v) => set(def.key, v)} />
        ))}
      </div>
    </div>
  );
}

function CustomFieldInput({ def, value, onChange }: { def: CustomFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cf_${def.key}`;
  const label = (
    <Label htmlFor={id}>
      {def.label}
      {def.is_required ? " *" : ""}
    </Label>
  );
  const help = def.help_text ? <p className="text-[11px] text-gray-500">{def.help_text}</p> : null;
  switch (def.field_type) {
    case "textarea":
      return (
        <div className="space-y-1.5 sm:col-span-2">
          {label}
          <Textarea id={id} rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
          <Checkbox checked={Boolean(value)} onCheckedChange={(v) => onChange(Boolean(v))} />
          {def.label}
        </label>
      );
    case "picklist":
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={value ? String(value) : "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
            <SelectTrigger id={id}><SelectValue placeholder="Pilih…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— kosong —</SelectItem>
              {def.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          {help}
        </div>
      );
    case "multipicklist": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex flex-wrap gap-2 pt-1">
            {def.options.map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                <Checkbox checked={selected.includes(o)} onCheckedChange={(v) => onChange(v ? [...selected, o] : selected.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </div>
          {help}
        </div>
      );
    }
    case "number":
      return (
        <div className="space-y-1.5">
          {label}
          <Input id={id} type="number" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} min={def.validation?.min} max={def.validation?.max} />
          {help}
        </div>
      );
    case "date":
      return (
        <div className="space-y-1.5">
          {label}
          <Input id={id} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    default:
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            id={id}
            type={def.field_type === "email" ? "email" : def.field_type === "url" ? "url" : def.field_type === "phone" ? "tel" : "text"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={def.field_type === "url" ? "https://" : undefined}
          />
          {help}
        </div>
      );
  }
}
