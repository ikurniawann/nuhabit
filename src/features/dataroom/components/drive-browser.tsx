"use client";

import { useState } from "react";
import { ChevronRight, Download, ExternalLink, Eye, Loader2, Lock, X } from "lucide-react";
import { formatBytes, isImageMime, isPreviewable } from "@/lib/dataroom/config";
import { formatDate } from "@/lib/format";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { nodeFileUrl, startDownload, useDataroomListing } from "@/features/dataroom/queries";
import type { DataroomItem } from "@/features/dataroom/types";

/**
 * Penjelajah Dataroom di jendela Drive Desktop (owner 2026-09-05): isi
 * folder departemen 1:1 dengan /dashboard/dataroom (API & hak akses sama),
 * bergaya gelap ala Desktop. Baca, pratinjau, unduh; kelola (upload,
 * bagikan, akses) lewat tombol "Buka di Dashboard". Induk me-render dengan
 * key=rootId agar state folder aktif ter-reset saat ganti departemen.
 */
export function DriveDataroomBrowser({ rootId, rootName }: { rootId: string; rootName: string }) {
  const [folderId, setFolderId] = useState(rootId);
  const [preview, setPreview] = useState<DataroomItem | null>(null);
  const listingQuery = useDataroomListing(folderId);
  const listing = listingQuery.data;
  const error = listingQuery.isError ? listingQuery.error.message || "Gagal memuat folder" : null;

  const ancestors = listing?.ancestors ?? [];
  const rootIdx = ancestors.findIndex((a) => a.id === rootId);
  const crumbs = rootIdx >= 0 ? ancestors.slice(rootIdx) : [{ id: rootId, name: rootName, parent_id: null }];
  const dl = (item: DataroomItem, inline = false) => nodeFileUrl(item.id, inline);

  const open = (item: DataroomItem) => {
    if (item.kind === "folder") setFolderId(item.id);
    else if (isPreviewable(item.mime)) setPreview(item);
    else startDownload(dl(item));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, idx) => (
            <span key={c.id} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="size-4 text-white/35" />}
              <button
                type="button"
                onClick={() => setFolderId(c.id)}
                className={`rounded-xl px-2 py-1 transition hover:bg-white/10 ${idx === crumbs.length - 1 ? "font-semibold text-white" : "text-white/65"}`}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <a
          href={`/dashboard/dataroom?folder=${folderId}`}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:bg-white/12"
        >
          <ExternalLink className="size-3.5" /> Buka di Dashboard
        </a>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      ) : !listing ? (
        <div className="flex items-center gap-2 p-4 text-sm text-white/55"><Loader2 className="size-4 animate-spin" /> Memuat…</div>
      ) : listing.items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-white/50">
          Folder ini masih kosong. Unggah file lewat Dashboard → Dataroom.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {listing.items.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => open(item)}
              onKeyDown={(e) => { if (e.key === "Enter") open(item); }}
              className="group flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12"
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10">
                <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{item.name}</div>
                <div className="mt-1 truncate text-xs text-white/45">
                  {item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"} · {formatDate(item.updated_at)}
                  {item.departments && item.departments.length > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-200/80"><Lock className="size-3" />{item.departments.map((d) => d.name).join(", ")}</span>
                  )}
                </div>
              </div>
              {item.kind === "file" && (
                <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                  {isPreviewable(item.mime) && (
                    <button type="button" title="Pratinjau" onClick={(e) => { e.stopPropagation(); setPreview(item); }} className="rounded-xl p-2 hover:bg-white/15"><Eye className="size-4" /></button>
                  )}
                  <a href={dl(item)} title="Unduh" onClick={(e) => e.stopPropagation()} className="rounded-xl p-2 hover:bg-white/15"><Download className="size-4" /></a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#1b1220] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <ItemIcon kind="file" mime={preview.mime} name={preview.name} className="size-5" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.name}</span>
              <span className="text-xs text-white/45">{formatBytes(preview.size_bytes)}</span>
              <a href={dl(preview)} className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15"><Download className="size-3.5" /> Unduh</a>
              <button type="button" onClick={() => setPreview(null)} className="rounded-xl p-1.5 hover:bg-white/15" aria-label="Tutup"><X className="size-4" /></button>
            </div>
            <div className="min-h-[50vh] flex-1 overflow-auto bg-black/40">
              {isImageMime(preview.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dl(preview, true)} alt={preview.name} className="mx-auto max-h-[78vh] w-auto max-w-full object-contain" />
              ) : (
                <iframe src={dl(preview, true)} title={preview.name} className="h-[78vh] w-full bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
