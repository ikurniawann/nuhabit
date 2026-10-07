"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban, Check, Copy, Droplets, Globe, Link2, Loader2, Lock, Mail, RefreshCw, ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiPost } from "@/lib/api-client";
import { DATAROOM_MAX_EXPIRY_DAYS, isWatermarkable, normalizeEmails } from "@/lib/dataroom/config";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import { dataroomKeys, useShareLogs, useShares } from "@/features/dataroom/queries";
import type { DataroomItem, ShareRow } from "@/features/dataroom/types";

/**
 * Dialog Bagikan: buat link (publik / email tertentu, PIN, watermark, masa
 * aktif) + daftar link yang sudah ada untuk item ini (salin, cabut, log).
 * Tanpa `node` → mode "Semua link" (panel di header halaman).
 */
const ACTION_LABEL: Record<string, string> = {
  open: "Membuka link", code_sent: "Kode dikirim", verified: "Terverifikasi", pin_failed: "PIN salah",
  code_failed: "Kode/email salah", view: "Melihat", download: "Mengunduh",
};

function shareStatus(s: ShareRow): { label: string; cls: string } {
  if (s.revoked_at) return { label: "Dicabut", cls: "bg-muted text-muted-foreground" };
  if (new Date(s.expires_at).getTime() < Date.now()) return { label: "Kedaluwarsa", cls: "bg-amber-100 text-amber-800" };
  return { label: "Aktif", cls: "bg-emerald-100 text-emerald-800" };
}

export function ShareDialog({ open, node, canManage, onClose }: {
  open: boolean; node: DataroomItem | null; canManage: boolean; onClose: () => void;
}) {
  const [accessType, setAccessType] = useState<"public" | "email">("public");
  const [emails, setEmails] = useState("");
  const [pin, setPin] = useState("");
  const [watermark, setWatermark] = useState(false);
  const [days, setDays] = useState(7);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ShareRow | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const sharesQuery = useShares(node?.id ?? null);
  const shares = sharesQuery.data ?? null;
  const logsQuery = useShareLogs(logsFor);
  const refreshShares = () => queryClient.invalidateQueries({ queryKey: dataroomKeys.allShares });

  const copy = async (s: ShareRow) => {
    try {
      await navigator.clipboard.writeText(s.url);
      setCopied(s.id);
      setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 1500);
      toast.success("Link disalin");
    } catch {
      toast.error("Gagal menyalin, salin manual dari kolom link");
    }
  };

  const submit = async () => {
    if (!node) return;
    const list = normalizeEmails(emails);
    if (accessType === "email" && list.length === 0) { toast.error("Isi minimal satu email penerima yang valid"); return; }
    if (pin && !/^\d{4,6}$/.test(pin)) { toast.error("PIN harus 4–6 digit angka"); return; }
    setBusy(true);
    try {
      const res = await apiPost<{ data: ShareRow }>("/api/dataroom/shares", {
        node_id: node.id, access_type: accessType, emails: list, pin: pin || null,
        watermark, expires_days: days, send_email: accessType === "email" && sendEmail,
      });
      setCreated(res.data);
      void refreshShares();
      const mail = res.data.mail;
      toast.success(
        mail ? `Link dibuat. Email terkirim ke ${mail.sent} penerima${mail.failed.length ? `, gagal: ${mail.failed.join(", ")}` : ""}` : "Link dibuat"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat link");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: ShareRow) => {
    if (!confirm(`Cabut link untuk "${s.node_name}"? Penerima langsung tidak bisa membuka.`)) return;
    try {
      await apiDelete(`/api/dataroom/shares/${s.id}`);
      toast.success("Link dicabut");
      void refreshShares();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencabut link");
    }
  };

  const toggleLogs = (s: ShareRow) => setLogsFor((current) => (current === s.id ? null : s.id));

  const wmSupported = !node || node.kind === "folder" || isWatermarkable(node.mime);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            {node ? (
              <><ItemIcon kind={node.kind} mime={node.mime} name={node.name} className="h-5 w-5" /><span className="truncate">Bagikan &quot;{node.name}&quot;</span></>
            ) : (
              <><Link2 className="h-5 w-5" />Semua link berbagi</>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {node && canManage && (
            <section className="space-y-4 rounded-lg border p-4">
              <h3 className="text-sm font-semibold">Buat link baru</h3>

              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "public", icon: Globe, t: "Publik", d: "Siapa pun yang punya link" },
                  { v: "email", icon: Mail, t: "Email tertentu", d: "Hanya email terdaftar (verifikasi kode)" },
                ] as const).map((o) => (
                  <button
                    key={o.v} type="button" onClick={() => setAccessType(o.v)}
                    className={cn("flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition", accessType === o.v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}
                  >
                    <o.icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><span className="block font-medium">{o.t}</span><span className="text-xs text-muted-foreground">{o.d}</span></span>
                  </button>
                ))}
              </div>

              {accessType === "email" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Email penerima (pisahkan dengan koma / baris baru)</label>
                  <Textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="nama@perusahaan.com, lain@domain.id" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                    Kirim link ke email penerima sekarang
                  </label>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lock className="h-3 w-3" />PIN (opsional, 4–6 digit)</label>
                  <Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Kosongkan bila tanpa PIN" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Masa aktif (hari)</label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={1} max={DATAROOM_MAX_EXPIRY_DAYS} value={days} onChange={(e) => setDays(Math.max(1, Math.min(DATAROOM_MAX_EXPIRY_DAYS, Number(e.target.value) || 1)))} className="w-24" />
                    {[1, 7, 30, 90].map((d) => (
                      <button key={d} type="button" onClick={() => setDays(d)} className={cn("rounded-md border px-2 py-1 text-xs", days === d ? "border-primary bg-primary/10 text-brand-text" : "hover:bg-muted")}>{d}h</button>
                    ))}
                  </div>
                </div>
              </div>

              <label className={cn("flex items-start gap-2 text-sm", !wmSupported && "opacity-50")}>
                <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!wmSupported} checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
                <span>
                  <span className="flex items-center gap-1 font-medium"><Droplets className="h-4 w-4" />Beri watermark saat dibuka/diunduh</span>
                  <span className="text-xs text-muted-foreground">
                    {wmSupported
                      ? "Berlaku untuk gambar (JPG/PNG/WebP) dan PDF: teks email penerima + tanggal ditanam diagonal. File asli tidak berubah."
                      : "Jenis file ini tidak mendukung watermark."}
                  </span>
                </span>
              </label>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Link akan aktif sampai {formatDateTime(openedAt + days * 86_400_000)}</p>
                <Button type="button" onClick={submit} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Buat link
                </Button>
              </div>

              {created && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                  <p className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">Link siap dibagikan</p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={created.url} onFocus={(e) => e.target.select()} className="bg-background font-mono text-xs" />
                    <Button type="button" variant="outline" size="sm" onClick={() => copy(created)}>
                      {copied === created.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{node ? "Link untuk item ini" : "Daftar link"}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => sharesQuery.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" />Muat ulang</Button>
            </div>
            {sharesQuery.isError ? (
              <p className="py-4 text-sm text-destructive">{sharesQuery.error.message || "Gagal memuat link"}</p>
            ) : shares === null ? (
              <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</p>
            ) : shares.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Belum ada link berbagi.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {shares.map((s) => {
                  const st = shareStatus(s);
                  return (
                    <li key={s.id} className="space-y-2 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
                        {!node && <span className="flex items-center gap-1 font-medium"><ItemIcon kind={s.node_kind} mime={null} name={s.node_name} className="h-4 w-4" />{s.node_name}</span>}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {s.access_type === "public" ? <><Globe className="h-3 w-3" />Publik</> : <><Mail className="h-3 w-3" />{s.allowed_emails.join(", ")}</>}
                        </span>
                        {s.has_pin && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />PIN</span>}
                        {s.watermark && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Droplets className="h-3 w-3" />Watermark</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={s.url} onFocus={(e) => e.target.select()} className="h-8 font-mono text-xs" />
                        <Button type="button" variant="outline" size="sm" onClick={() => copy(s)} title="Salin link">
                          {copied === s.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => toggleLogs(s)} title="Log akses"><ScrollText className="h-4 w-4" /></Button>
                        {canManage && !s.revoked_at && (
                          <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => revoke(s)} title="Cabut link"><Ban className="h-4 w-4" /></Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Aktif sampai {formatDateTime(s.expires_at)} · dibuat {formatDateTime(s.created_at)} oleh {s.created_by_name ?? "—"} · dibuka {s.view_count}× · {s.access_count} lihat/unduh
                        {s.last_accessed_at && <> · terakhir {formatDateTime(s.last_accessed_at)}</>}
                      </p>
                      {logsFor === s.id && (
                        <div className="rounded-md bg-muted/50 p-2">
                          {logsQuery.isError ? (
                            <p className="text-xs text-destructive">{logsQuery.error.message || "Gagal memuat log"}</p>
                          ) : !logsQuery.data ? (
                            <p className="text-xs text-muted-foreground">Memuat log…</p>
                          ) : logsQuery.data.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Belum ada aktivitas.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <tbody>
                                {logsQuery.data.map((l) => (
                                  <tr key={l.id} className="border-b last:border-0">
                                    <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{formatDateTime(l.created_at)}</td>
                                    <td className="py-1 pr-2 font-medium">{ACTION_LABEL[l.action] ?? l.action}</td>
                                    <td className="py-1 pr-2 truncate max-w-[180px]">{l.file_name ?? ""}</td>
                                    <td className="py-1 pr-2">{l.email ?? "—"}</td>
                                    <td className="py-1 text-muted-foreground">{l.ip ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
