"use client";

import { useRef } from "react";
import { wallpaperBackgroundStyle, type WallpaperItem } from "@/lib/desktop/wallpapers";
import { useDeleteWallpaper, useUploadWallpaper } from "../../hooks/use-wallpapers";
import { WindowShell } from "../windows/window-shell";

export function WallpaperPicker({
  items,
  selected,
  canManage,
  onSelect,
  onUploaded,
  onDeleted,
  onClose,
}: {
  items: WallpaperItem[];
  selected: string;
  canManage: boolean;
  onSelect: (wallpaper: WallpaperItem) => void;
  onUploaded: (wallpaper: WallpaperItem) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadWallpaper(onUploaded);
  const remove = useDeleteWallpaper(onDeleted);
  const error = upload.error ?? remove.error;

  const confirmRemove = (item: WallpaperItem) => {
    if (!window.confirm(`Hapus wallpaper "${item.name}"? Berkasnya ikut dihapus dari server.`)) return;
    upload.reset();
    remove.mutate(item.id);
  };

  return (
    <WindowShell title="Desktop & Wallpaper" onClose={onClose} className="left-1/2 top-20 w-[min(720px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-5">
        {canManage && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Wallpaper sendiri</div>
              <div className="text-xs text-white/50">JPG / PNG / WebP, maks 8 MB. Tampil untuk semua pengguna desktop.</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                remove.reset();
                upload.mutate(file, {
                  onSettled: () => {
                    if (fileRef.current) fileRef.current.value = "";
                  },
                });
              }}
            />
            <button
              type="button"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl bg-white/15 px-4 py-2 text-sm font-semibold transition hover:bg-white/25 disabled:opacity-50"
            >
              {upload.isPending ? "Mengunggah…" : "Unggah wallpaper"}
            </button>
          </div>
        )}
        {error && <div className="mb-3 rounded-2xl border border-red-300/40 bg-red-500/15 px-4 py-2 text-xs text-red-100">{error.message}</div>}
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {items.map((item) => {
            const deleting = remove.isPending && remove.variables === item.id;
            return (
              <div
                key={item.id}
                className={`group relative rounded-3xl border p-3 text-left transition hover:bg-white/10 ${selected === item.id ? "border-pink-200/60 bg-white/14" : "border-white/10 bg-white/8"}`}
              >
                <button type="button" onClick={() => onSelect(item)} className="block w-full text-left">
                  <div className="mb-3 h-24 rounded-2xl bg-cover bg-center" style={wallpaperBackgroundStyle(item.src)} />
                  <div className="truncate text-sm font-semibold">{item.name}</div>
                  <div className="text-xs text-white/45">{item.custom ? "Wallpaper unggahan" : "Mac-style desktop wallpaper"}</div>
                </button>
                {canManage && item.custom && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => confirmRemove(item)}
                    className="absolute right-5 top-5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/90 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/80 disabled:opacity-50"
                  >
                    {deleting ? "…" : "Hapus"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WindowShell>
  );
}
