"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Pilih & unggah gambar ke /api/studio/uploads; nilai = URL publik. */
export function ImageUpload({ value, onChange, shape = "square" }: { value: string; onChange: (url: string) => void; shape?: "square" | "wide" }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/studio/uploads", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error ?? "Upload gagal");
      onChange(body.data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload gagal");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const box = shape === "wide" ? "aspect-[16/9] w-full" : "size-24";
  return (
    <div className="flex items-center gap-3">
      <div className={`relative overflow-hidden rounded-xl border border-dashed border-border bg-secondary/50 ${box}`}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImagePlus className="size-6" />
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {value ? "Ganti gambar" : "Unggah gambar"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onChange("")}>
            <X className="size-3.5" /> Hapus
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">JPG/PNG/WebP, maks 5 MB</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
