"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight, Clock, Download, Droplets, Eye, FolderOpen, Loader2, Lock, Mail, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api-client";
import { brandName } from "@/lib/branding";
import { formatBytes, isPreviewable } from "@/lib/dataroom/config";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { PreviewDialog } from "@/features/dataroom/components/preview-dialog";
import type { DataroomItem } from "@/features/dataroom/types";

/**
 * Halaman publik /share/[token]: gerbang verifikasi (email + kode 6 digit
 * dan/atau PIN), lalu penjelajah folder / kartu file dengan pratinjau dan
 * unduh (watermark ditanam server bila diaktifkan pengirim).
 */
interface ShareMeta {
  name: string;
  kind: "folder" | "file";
  access_type: "public" | "email";
  requires_pin: boolean;
  watermark: boolean;
  expires_at: string;
  shared_by: string | null;
  steps: { needEmail: boolean; needPin: boolean };
  verified: boolean;
  email: string | null;
  root: DataroomItem | null;
  items: DataroomItem[];
}

interface Listing { folder: DataroomItem; ancestors: { id: string; name: string }[]; items: DataroomItem[] }

export function SharePage({ token }: { token: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [preview, setPreview] = useState<DataroomItem | null>(null);

  const base = `/api/share/${token}`;

  const metaQuery = useQuery({
    queryKey: ["dataroom", "share-meta", token],
    queryFn: () => apiGet<{ data: ShareMeta }>(base).then((res) => res.data),
    retry: false,
  });
  const meta = metaQuery.data ?? null;
  const error = metaQuery.isError ? metaQuery.error.message || "Link tidak bisa dibuka" : null;

  const openFolder = useCallback((folderId: string) => {
    apiGet<{ data: Listing }>(`${base}/list?folder=${folderId}`)
      .then((res) => setListing(res.data))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Gagal memuat folder"));
  }, [base]);

  const fileUrl = (item: DataroomItem, download: boolean) => `${base}/files/${item.id}${download ? "?download=1" : ""}`;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FolderOpen className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{brandName()} · Dataroom</p>
            <h1 className="truncate text-base font-semibold">{meta?.name ?? "Berkas dibagikan"}</h1>
          </div>
          {meta && (
            <div className="ml-auto hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
              {meta.shared_by && <span>Dibagikan oleh {meta.shared_by}</span>}
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Aktif sampai {formatDateTime(meta.expires_at)}</span>
              {meta.watermark && <span className="flex items-center gap-1"><Droplets className="h-3.5 w-3.5" />Watermark</span>}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {error ? (
          <div className="mx-auto max-w-md rounded-xl border bg-white p-8 text-center">
            <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Link tidak bisa dibuka</h2>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !meta ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</div>
        ) : !meta.verified ? (
          <Gate token={token} meta={meta} onVerified={() => void metaQuery.refetch()} />
        ) : meta.kind === "file" && meta.root ? (
          <FileCard item={meta.root} inlineUrl={fileUrl(meta.root, false)} downloadUrl={fileUrl(meta.root, true)} onPreview={() => setPreview(meta.root)} />
        ) : (
          <FolderBrowser
            root={meta.root as DataroomItem}
            rootItems={meta.items}
            listing={listing}
            onOpenFolder={openFolder}
            onBackToRoot={() => setListing(null)}
            onPreview={setPreview}
            fileUrl={fileUrl}
          />
        )}
      </main>

      {preview && (
        <PreviewDialog
          open name={preview.name} mime={preview.mime} size={preview.size_bytes}
          inlineUrl={fileUrl(preview, false)} downloadUrl={fileUrl(preview, true)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function Gate({ token, meta, onVerified }: { token: string; meta: ShareMeta; onVerified: () => void }) {
  const [email, setEmail] = useState(meta.email ?? "");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/api/share/${token}`;

  const requestCode = async () => {
    if (!email.trim()) { toast.error("Isi email Anda"); return; }
    setBusy(true);
    try {
      await apiPost(`${base}/request-code`, { email: email.trim() });
      setCodeSent(true);
      toast.success("Kode verifikasi dikirim ke email Anda");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim kode");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      await apiPost(`${base}/verify`, {
        email: email.trim() || undefined, code: code.trim() || undefined, pin: pin.trim() || undefined,
      });
      onVerified();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verifikasi gagal");
      onVerified(); // progres parsial (mis. email lolos, PIN salah) ikut termuat
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-brand-text" />
        <div>
          <h2 className="font-semibold">Verifikasi akses</h2>
          <p className="text-xs text-muted-foreground">
            {meta.steps.needEmail && meta.steps.needPin ? "Link ini dilindungi verifikasi email dan PIN."
              : meta.steps.needEmail ? "Link ini hanya untuk email tertentu." : "Link ini dilindungi PIN."}
          </p>
        </div>
      </div>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        {meta.steps.needEmail && (
          <div className="space-y-2">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Mail className="h-3.5 w-3.5" />Email penerima</label>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" autoFocus />
              <Button type="button" variant="outline" onClick={requestCode} disabled={busy || !email.trim()}>
                {codeSent ? "Kirim ulang" : "Kirim kode"}
              </Button>
            </div>
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="Kode 6 digit dari email" className="tracking-[0.3em]" />
          </div>
        )}
        {meta.steps.needPin && (
          <div className="space-y-2">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lock className="h-3.5 w-3.5" />PIN dari pengirim</label>
            <Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" autoFocus={!meta.steps.needEmail} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy || (meta.steps.needEmail && (!email.trim() || code.length < 6)) || (meta.steps.needPin && pin.length < 4)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buka berkas
        </Button>
      </form>
    </div>
  );
}

function FileCard({ item, inlineUrl, downloadUrl, onPreview }: { item: DataroomItem; inlineUrl: string; downloadUrl: string; onPreview: () => void }) {
  const previewable = isPreviewable(item.mime);
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-white shadow-sm">
      {previewable && item.mime?.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={inlineUrl} alt={item.name} className="max-h-[60vh] w-full bg-muted object-contain" />
      ) : previewable ? (
        <iframe src={inlineUrl} title={item.name} className="h-[60vh] w-full bg-white" />
      ) : null}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <ItemIcon kind="file" mime={item.mime} name={item.name} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(item.size_bytes)} · {formatDateTime(item.updated_at)}</p>
        </div>
        {previewable && <Button variant="outline" onClick={onPreview}><Eye className="mr-2 h-4 w-4" />Pratinjau</Button>}
        <Button onClick={() => { window.location.assign(downloadUrl); }}><Download className="mr-2 h-4 w-4" />Unduh</Button>
      </div>
    </div>
  );
}

function FolderBrowser({ root, rootItems, listing, onOpenFolder, onBackToRoot, onPreview, fileUrl }: {
  root: DataroomItem; rootItems: DataroomItem[]; listing: Listing | null;
  onOpenFolder: (id: string) => void; onBackToRoot: () => void;
  onPreview: (item: DataroomItem) => void; fileUrl: (item: DataroomItem, download: boolean) => string;
}) {
  const items = listing ? listing.items : rootItems;
  const crumbs = listing ? listing.ancestors : [{ id: root.id, name: root.name }];
  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <nav className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-sm">
        {crumbs.map((c, idx) => (
          <span key={c.id} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => (c.id === root.id ? onBackToRoot() : onOpenFolder(c.id))}
              className={cn("rounded-md px-2 py-1 hover:bg-muted", idx === crumbs.length - 1 && "font-medium text-brand-text")}
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Folder ini kosong.</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
              <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-7 w-7 shrink-0" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => (item.kind === "folder" ? onOpenFolder(item.id) : isPreviewable(item.mime) ? onPreview(item) : (window.location.assign(fileUrl(item, true))))}
              >
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"} · {formatDateTime(item.updated_at)}</p>
              </button>
              {item.kind === "file" && (
                <div className="flex shrink-0 gap-1">
                  {isPreviewable(item.mime) && (
                    <Button variant="ghost" size="sm" onClick={() => onPreview(item)} title="Pratinjau"><Eye className="h-4 w-4" /></Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { window.location.assign(fileUrl(item, true)); }} title="Unduh"><Download className="h-4 w-4" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
