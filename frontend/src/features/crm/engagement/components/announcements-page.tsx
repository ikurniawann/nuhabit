"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, ImageIcon, Link2, Megaphone, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPortalLink, PORTAL_LINK_OPTIONS } from "@/lib/member-portal/links";
import { cn } from "@/lib/utils";
import { engagementApi, waktu, type Announcement, type AudienceInput } from "../api";
import { formatNumber } from "@/lib/format";
import { Field, TableNote, TEXTAREA } from "./shared";

const KIND_LABEL: Record<Announcement["kind"], string> = { announcement: "Pengumuman", promo: "Promo" };
const NO_LINK = "none";
const PROMO_LINK = "promo";

async function uploadImage(file: File): Promise<string> {
  const data = new FormData();
  data.append("file", file);
  const res = await fetch("/api/crm/engagement/announcements/image", { method: "POST", body: data });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Upload gagal");
  return json.data.url as string;
}

function audienceText(audience: AudienceInput): string {
  const parts: string[] = [];
  if (audience.tier_codes?.length) parts.push(`Tier ${audience.tier_codes.join(", ")}`);
  if (audience.min_visits) parts.push(`≥ ${audience.min_visits} kunjungan`);
  if (audience.inactive_days) parts.push(`tidak berkunjung ${audience.inactive_days} hari`);
  return parts.length ? parts.join(" · ") : "Semua member";
}

/** CRM → Engagement → Pengumuman Member: kirim ke kotak masuk portal /member. */
export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: ["crm-engagement", "announcements"], queryFn: engagementApi.announcements });
  const tiers = useQuery({ queryKey: ["crm-engagement", "tiers"], queryFn: engagementApi.tiers });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Announcement["kind"]>("announcement");
  const [tierCodes, setTierCodes] = useState<string[]>([]);
  const [minVisits, setMinVisits] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState(NO_LINK);
  const [promoCode, setPromoCode] = useState("");

  const audience: AudienceInput = {
    tier_codes: tierCodes.length ? tierCodes : undefined,
    min_visits: Number(minVisits) || undefined,
    inactive_days: Number(inactiveDays) || undefined,
  };
  const linkUrl =
    linkTarget === NO_LINK ? null : linkTarget === PROMO_LINK ? `promo:${promoCode.trim().toUpperCase()}` : linkTarget;
  const linkValid = linkUrl === null || isPortalLink(linkUrl);
  const valid = title.trim().length >= 3 && body.trim().length >= 3 && linkValid;

  const uploadMutation = useMutation({
    mutationFn: uploadImage,
    onSuccess: setImageUrl,
    onError: (error) => toast.error("Gambar gagal diunggah", { description: error.message }),
  });

  const previewMutation = useMutation({
    mutationFn: () => engagementApi.previewAudience(audience),
    onSuccess: (data) => setPreview(data.recipients),
    onError: (error) => toast.error(error.message),
  });
  const sendMutation = useMutation({
    mutationFn: () =>
      engagementApi.sendAnnouncement({
        title: title.trim(),
        body: body.trim(),
        kind,
        audience,
        image_url: imageUrl,
        link_url: linkUrl,
      }),
    onSuccess: (data) => {
      toast.success("Pengumuman terkirim", { description: `${formatNumber(data.recipients)} member menerimanya di portal.` });
      setTitle("");
      setBody("");
      setPreview(null);
      setImageUrl(null);
      setLinkTarget(NO_LINK);
      setPromoCode("");
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["crm-engagement", "announcements"] });
    },
    onError: (error) => toast.error("Pengumuman gagal dikirim", { description: error.message }),
  });

  const rows = history.data ?? [];
  const totalRecipients = rows.reduce((sum, a) => sum + a.recipient_count, 0);
  const totalRead = rows.reduce((sum, a) => sum + a.read_count, 0);

  const changeAudience = (update: () => void) => {
    update();
    setPreview(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Engagement"
        title="Pengumuman Member"
        description="Kirim kabar atau promo ke kotak masuk portal member. Member melihatnya lewat ikon lonceng."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Terkirim" value={formatNumber(rows.length)} unit="pengumuman" icon={<Megaphone />} tone="ink" />
        <StatCard label="Total penerima" value={formatNumber(totalRecipients)} unit="member" icon={<Users />} />
        <StatCard
          label="Dibaca"
          value={totalRecipients ? Math.round((totalRead / totalRecipients) * 100) : 0}
          unit="%"
          hint={`${formatNumber(totalRead)} dari ${formatNumber(totalRecipients)} notifikasi`}
          icon={<Eye />}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Tulis pengumuman</h2>
            </CardTitle>
            <CardDescription>Terkirim sekali ke semua member yang cocok dengan audiens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-flex gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Jenis">
              {(["announcement", "promo"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className={cn(
                    "h-9 rounded-full px-4 text-sm font-semibold transition-colors",
                    kind === value ? "bg-ink text-on-ink" : "text-body hover:bg-black/5"
                  )}
                >
                  {KIND_LABEL[value]}
                </button>
              ))}
            </div>
            <Field label="Judul">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Menu musim hujan sudah hadir" maxLength={120} />
            </Field>
            <Field label="Isi" hint={`${body.length}/1000 karakter`}>
              <textarea
                className={TEXTAREA}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={1000}
                placeholder="Coba Hot Ginger Latte di semua outlet mulai Senin."
              />
            </Field>

            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Gambar (opsional)</span>
              {imageUrl ? (
                <div className="relative overflow-hidden rounded-2xl bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL unggahan lokal /api/files */}
                  <img src={imageUrl} alt="Pratinjau gambar pengumuman" className="h-40 w-full object-cover" />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => setImageUrl(null)}
                    aria-label="Hapus gambar"
                  >
                    <X /> Hapus
                  </Button>
                </div>
              ) : (
                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-body hover:bg-surface">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploadMutation.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) uploadMutation.mutate(file);
                    }}
                  />
                  <ImageIcon className="size-4" />
                  {uploadMutation.isPending ? "Mengunggah…" : "Unggah gambar (JPG/PNG/WebP, maks 5 MB)"}
                </label>
              )}
            </div>

            <div className="space-y-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Link2 className="size-4" /> Tombol ke halaman portal (opsional)
              </span>
              <Select value={linkTarget} onValueChange={setLinkTarget}>
                <SelectTrigger aria-label="Tujuan di portal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINK}>Tanpa tombol</SelectItem>
                  {PORTAL_LINK_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={PROMO_LINK}>Detail promo (kode)</SelectItem>
                </SelectContent>
              </Select>
              {linkTarget === PROMO_LINK && (
                <Input
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder="Kode promo, mis. KOPI10"
                  maxLength={40}
                  aria-invalid={!linkValid}
                />
              )}
              {linkTarget === PROMO_LINK && !linkValid && promoCode && (
                <p className="text-xs text-danger">Kode: huruf, angka, atau strip, 3-40 karakter.</p>
              )}
            </div>

            <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Audiens</p>
              <div className="flex flex-wrap gap-2">
                {(tiers.data ?? []).map((tier) => {
                  const active = tierCodes.includes(tier.code);
                  return (
                    <button
                      key={tier.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        changeAudience(() =>
                          setTierCodes((cur) => (active ? cur.filter((c) => c !== tier.code) : [...cur, tier.code]))
                        )
                      }
                      className={cn(
                        "h-9 rounded-full border px-3.5 text-xs font-semibold transition-colors",
                        active
                          ? "border-accent-strong bg-accent-strong text-accent-foreground"
                          : "border-border bg-card text-body hover:bg-surface"
                      )}
                    >
                      {tier.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Tanpa tier terpilih, semua tier ikut.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Minimal kunjungan">
                  <Input type="number" min={0} value={minVisits} onChange={(e) => changeAudience(() => setMinVisits(e.target.value))} placeholder="0" />
                </Field>
                <Field label="Tidak berkunjung selama (hari)">
                  <Input type="number" min={0} value={inactiveDays} onChange={(e) => changeAudience(() => setInactiveDays(e.target.value))} placeholder="0" />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
                  <Users /> Hitung penerima
                </Button>
                {preview !== null && (
                  <span className="text-sm text-body">
                    <strong className="tabular-nums">{formatNumber(preview)}</strong> member · {audienceText(audience)}
                  </span>
                )}
              </div>
            </div>

            <Button className="w-full" disabled={!valid || sendMutation.isPending} onClick={() => setConfirming(true)}>
              <Send /> Kirim pengumuman
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Riwayat</h2>
            </CardTitle>
          </CardHeader>
          {history.isLoading ? (
            <TableNote>Memuat riwayat…</TableNote>
          ) : history.error ? (
            <TableNote tone="danger">{history.error.message}</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Belum ada pengumuman. Tulis yang pertama di sebelah kiri.</TableNote>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pengumuman</TableHead>
                  <TableHead className="hidden md:table-cell">Audiens</TableHead>
                  <TableHead className="text-right">Dibaca</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-[18rem] whitespace-normal">
                      <div className="flex items-center gap-2">
                        <Badge variant={a.kind === "promo" ? "accent" : "default"}>{KIND_LABEL[a.kind]}</Badge>
                        <span className="truncate font-medium">{a.title}</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {a.sent_at ? waktu(a.sent_at) : "—"}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {audienceText(a.audience)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(a.read_count)} / {formatNumber(a.recipient_count)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Kirim "${title.trim()}"?`}
        description={`Pengumuman langsung masuk ke kotak masuk ${audienceText(audience).toLowerCase()} dan tidak bisa ditarik kembali.`}
        confirmLabel="Kirim"
        loading={sendMutation.isPending}
        onConfirm={() => sendMutation.mutate()}
      />
    </div>
  );
}
