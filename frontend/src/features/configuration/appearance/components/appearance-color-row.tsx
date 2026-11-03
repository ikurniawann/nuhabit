"use client";

import { RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";

export function AppearanceColorRow({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      <label className="flex h-9 w-[9.5rem] cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 border-0 bg-transparent px-0 font-mono text-xs uppercase shadow-none focus-visible:ring-0"
        />
      </label>
      <button
        type="button"
        title="Reset token ini"
        onClick={() => onChange(defaultValue)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RotateCcw className="size-3.5" />
      </button>
    </div>
  );
}
