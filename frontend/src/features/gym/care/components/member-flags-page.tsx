"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { MemberLink } from "@/features/gym/members/member-link";
import { SELECT } from "@/features/gym/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { Can } from "@/components/iam/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber } from "@/lib/format";
import { CARE_KEYS, careApi, type FlagCategory, type FlagColor, type FlagIcon, type FlagType } from "../api";
import { CATEGORY_LABEL, FLAG_BADGE, FLAG_COLOR_LABEL, FLAG_ICON_LABEL, hiddenMedicalLabel, REVIEW_LABEL, SOURCE_LABEL } from "../display";
import { FLAG_ICONS, FlagBadge } from "./flag-badges";
import { useRefreshCare } from "./flag-dialogs";

const PAGE_SIZE = 25;

/** Gym → Member Perhatian Khusus: penanda aktif semua member dan jenis penandanya. */
export function MemberFlagsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Member Perhatian Khusus"
        description="Penanda tampil di roster kelas, roster PT, profil member dan hasil check-in. Detail penanda medis hanya untuk coach yang memegang sesi member itu dan manajer gym; staf lain hanya melihat jumlahnya."
      />
      <Tabs defaultValue="flags" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="flags">Penanda aktif</TabsTrigger>
          <TabsTrigger value="types">Jenis penanda</TabsTrigger>
        </TabsList>
        <TabsContent value="flags" className="mt-4">
          <ActiveFlags />
        </TabsContent>
        <TabsContent value="types" className="mt-4">
          <FlagTypes />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ActiveFlags() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<FlagCategory | "">("");
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const params = { q: term, category, page: String(page), page_size: String(PAGE_SIZE) };
  const list = useQuery({ queryKey: CARE_KEYS.list(params), queryFn: () => careApi.list(params) });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Cari nama atau nomor HP"
            aria-label="Cari member"
          />
        </div>
        <select
          className={`${SELECT} w-auto`}
          value={category}
          aria-label="Kategori"
          onChange={(e) => {
            setCategory(e.target.value as FlagCategory | "");
            setPage(1);
          }}
        >
          <option value="">Semua kategori</option>
          <option value="general">Umum</option>
          <option value="medical">Medis</option>
        </select>
      </div>
      {data && data.hidden_medical > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {hiddenMedicalLabel(data.hidden_medical)} lain tidak ditampilkan karena detailnya hanya untuk coach member itu dan manajer gym.
        </p>
      )}
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat penanda…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : !data || data.rows.length === 0 ? (
          <TableNote>Tidak ada penanda aktif.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Penanda</TableHead>
                <TableHead className="hidden md:table-cell">Catatan</TableHead>
                <TableHead className="hidden sm:table-cell">Sampai</TableHead>
                <TableHead className="hidden lg:table-cell">Dicatat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <MemberLink id={f.customer_id} name={f.customer_name} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap gap-1">
                      <FlagBadge flag={f} />
                      {f.review_status && (
                        <Badge variant={f.review_status === "pending" ? "warning" : "muted"}>{REVIEW_LABEL[f.review_status]}</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[22rem] whitespace-normal text-muted-foreground md:table-cell">{f.note || "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{f.expires_on ? formatDate(f.expires_on) : "Tanpa batas"}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {SOURCE_LABEL[f.source]}
                    {f.created_by_name && f.source !== "parq" ? `, ${f.created_by_name}` : ""} · {formatDate(f.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatNumber(data.total)} penanda · halaman {page} dari {pages}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Sebelumnya
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Berikutnya
            </Button>
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Tambah penanda dari profil member (Gym → Member) atau dari roster kelas di Kelas Saya.</p>
    </div>
  );
}

function FlagTypes() {
  const types = useQuery({ queryKey: CARE_KEYS.types(true), queryFn: () => careApi.types(true) });
  const [editing, setEditing] = useState<FlagType | "new" | null>(null);
  const rows = types.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can menu="gym.member-flags" action="create" mode="disable">
          <Button onClick={() => setEditing("new")}>
            <Plus /> Jenis penanda
          </Button>
        </Can>
      </div>
      <Card className="py-0">
        {types.isLoading ? (
          <TableNote>Memuat jenis penanda…</TableNote>
        ) : types.error ? (
          <TableNote tone="danger">{types.error.message}</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jenis</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="hidden sm:table-cell">Masa berlaku bawaan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const Icon = FLAG_ICONS[t.icon];
                return (
                  <TableRow key={t.id} className={t.is_active ? undefined : "opacity-60"}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant={FLAG_BADGE[t.color]}>
                          {Icon && <Icon aria-hidden />}
                          {t.label}
                        </Badge>
                        {t.is_system && <Badge variant="muted">Sistem</Badge>}
                        {!t.is_active && <Badge variant="muted">Nonaktif</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{CATEGORY_LABEL[t.category]}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {t.default_expiry_days ? `${formatNumber(t.default_expiry_days)} hari` : "Tanpa batas"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Can menu="gym.member-flags" action="update">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                          Ubah
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && <FlagTypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FlagTypeDialog({ type, onClose }: { type: FlagType | null; onClose: () => void }) {
  const refresh = useRefreshCare();
  const [form, setForm] = useState({
    label: type?.label ?? "",
    category: type?.category ?? ("general" as FlagCategory),
    color: type?.color ?? ("info" as FlagColor),
    icon: type?.icon ?? ("flag" as FlagIcon),
    days: type?.default_expiry_days ? String(type.default_expiry_days) : "",
    sort_order: String(type?.sort_order ?? 100),
    is_active: type?.is_active ?? true,
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: form.label.trim(),
        category: form.category,
        color: form.color,
        icon: form.icon,
        default_expiry_days: form.days ? Number(form.days) : null,
        sort_order: Number(form.sort_order),
        is_active: form.is_active,
      };
      return type ? careApi.updateType(type.id, body) : careApi.createType(body);
    },
    onSuccess: () => {
      toast.success("Jenis penanda disimpan", { description: form.label });
      refresh();
      onClose();
    },
    onError: (error) => toast.error("Jenis penanda gagal disimpan", { description: error.message }),
  });
  const locked = type?.is_system ?? false;
  const valid = form.label.trim().length > 0 && form.label.trim().length <= 40 && (!form.days || Number(form.days) >= 1);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{type ? `Ubah ${type.label}` : "Jenis penanda baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Jenis medis menyembunyikan detail penanda dari staf selain coach member itu dan manajer gym.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama" className="sm:col-span-2">
              <Input value={form.label} onChange={set("label")} maxLength={40} placeholder="Cedera bahu" required />
            </Field>
            <Field label="Kategori" hint={locked ? "Jenis sistem tetap medis." : undefined}>
              <select className={SELECT} value={form.category} onChange={set("category")} disabled={locked}>
                <option value="general">Umum</option>
                <option value="medical">Medis</option>
              </select>
            </Field>
            <Field label="Masa berlaku bawaan (hari)" hint="Kosongkan bila tanpa batas.">
              <Input type="number" min={1} max={3650} value={form.days} onChange={set("days")} />
            </Field>
            <Field label="Warna">
              <select className={SELECT} value={form.color} onChange={set("color")}>
                {Object.entries(FLAG_COLOR_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ikon">
              <select className={SELECT} value={form.icon} onChange={set("icon")}>
                {Object.entries(FLAG_ICON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Urutan">
              <Input type="number" min={0} max={10000} value={form.sort_order} onChange={set("sort_order")} />
            </Field>
            {type && !locked && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-forest)]"
                  checked={form.is_active}
                  onChange={(e) => setForm((cur) => ({ ...cur, is_active: e.target.checked }))}
                />
                Aktif
              </label>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
