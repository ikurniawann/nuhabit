import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Primitif bersama halaman Konfigurasi Loyalty. */

export const inputClass =
  "h-10 border-gray-200/80 bg-white focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30";

export const thClass = "px-4 py-3 font-semibold";

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Aktif</Badge>
  ) : (
    <Badge variant="secondary">Nonaktif</Badge>
  );
}

export function TableMessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export function LabeledInput({
  id,
  label,
  value,
  onChange,
  className = "",
  ...inputProps
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        {...inputProps}
      />
    </div>
  );
}

export function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2">
      <Label htmlFor={id} className="text-sm text-foreground">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
