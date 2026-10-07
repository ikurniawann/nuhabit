"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Layers, Package, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { formatNumber, formatRupiah } from "@/lib/format";
import {
  gymCreditsApi,
  KIND_LABELS,
  type BranchOption,
  type ClassTypeOption,
  type CreditPackage,
  type PackageKind,
} from "../api";

const PACKAGES_KEY = ["gym-credits", "packages"];

/** Gym → Paket Kredit: katalog paket kelas yang dijual di portal dan front desk. */
export function PackagesPage() {
  const queryClient = useQueryClient();
  const packages = useQuery({ queryKey: PACKAGES_KEY, queryFn: gymCreditsApi.packages });
  const [editing, setEditing] = useState<CreditPackage | "new" | null>(null);
  const [deleting, setDeleting] = useState<CreditPackage | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: PACKAGES_KEY });

  const setStatus = useMutation({
    mutationFn: (p: CreditPackage) => gymCreditsApi.setPackageStatus(p.id, p.status === "active" ? "archived" : "active"),
    onSuccess: (_data, p) => {
      toast.success(p.status === "active" ? "Paket diarsipkan" : "Paket dijual lagi", { description: p.name });
      refresh();
    },
    onError: (error) => toast.error("Status paket gagal diubah", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => gymCreditsApi.deletePackage(id),
    onSuccess: () => {
      toast.success("Paket dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("Paket gagal dihapus", { description: error.message }),
  });

  const rows = packages.data?.packages ?? [];
  const classTypes = packages.data?.class_types ?? [];
  const branches = packages.data?.branches ?? [];
  const active = rows.filter((p) => p.status === "active");
  const sold = rows.reduce((sum, p) => sum + p.sold_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Paket Kredit"
        description="Paket kredit dan pass yang dijual ke member. Satu kredit = satu slot kelas sesuai biaya kelasnya; pass membuka booking tanpa batas selama masa berlakunya. Paket yang sudah pernah dibeli hanya bisa diarsipkan."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Paket baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Paket dijual" value={formatNumber(active.length)} icon={<Package />} tone="ink" />
        <StatCard label="Diarsipkan" value={formatNumber(rows.length - active.length)} icon={<Archive />} />
        <StatCard label="Terjual" value={formatNumber(sold)} unit="pembelian" icon={<ShoppingBag />} />
      </div>

      <Card className="py-0">
        {packages.isLoading ? (
          <TableNote>Memuat paket…</TableNote>
        ) : packages.error ? (
          <TableNote tone="danger">{packages.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada paket. Klik Paket baru untuk membuat yang pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Kredit</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="hidden md:table-cell">Berlaku</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Terjual</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={p.status === "archived" ? "opacity-60" : undefined}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <p className="font-medium">
                      {p.name}
                      {p.kind === "pass" && (
                        <Badge variant="ink" className="ml-2">
                          Pass
                        </Badge>
                      )}
                      {p.badge && (
                        <Badge variant="accent" className="ml-2">
                          {p.badge}
                        </Badge>
                      )}
                      {!p.is_public && (
                        <Badge variant="muted" className="ml-2">
                          Tidak tampil di situs
                        </Badge>
                      )}
                      {p.status === "archived" && (
                        <Badge variant="muted" className="ml-2">
                          Arsip
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.purchase_limit_per_member ? `Maks. ${p.purchase_limit_per_member}× per member` : null,
                        p.kind === "pass" ? "Booking tanpa batas" : p.applicable_class_type_ids ? `${p.applicable_class_type_ids.length} jenis kelas` : "Semua kelas",
                        p.branch_name ?? "Semua cabang",
                        p.branch_prices.length > 0 ? `${p.branch_prices.length} harga cabang` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.kind === "pass" ? "∞" : formatNumber(p.credits)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(p.price_idr)}
                    {p.kind === "credits" && (
                      <span className="block text-xs text-muted-foreground">{formatRupiah(Math.round(p.price_idr / p.credits))}/kredit</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatNumber(p.validity_days)} hari</TableCell>
                  <TableCell className="hidden lg:table-cell text-right tabular-nums">{formatNumber(p.sold_count)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Ubah
                      </Button>
                      <Button variant="ghost" size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate(p)}>
                        {p.status === "active" ? "Arsipkan" : "Jual lagi"}
                      </Button>
                      {!p.referenced && (
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(p)}>
                          Hapus
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <PackageDialog
          pkg={editing === "new" ? null : editing}
          classTypes={classTypes}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Hapus ${deleting?.name ?? "paket"}?`}
        description="Paket ini belum pernah dibeli, jadi aman dihapus permanen."
        confirmLabel="Hapus paket"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function PackageDialog({
  pkg,
  classTypes,
  branches,
  onClose,
  onSaved,
}: {
  pkg: CreditPackage | null;
  classTypes: ClassTypeOption[];
  branches: BranchOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Kosong = kredit berlaku untuk semua jenis kelas.
  const [coverage, setCoverage] = useState<string[]>(pkg?.applicable_class_type_ids ?? []);
  const [kind, setKind] = useState<PackageKind>(pkg?.kind ?? "credits");
  const [isPublic, setIsPublic] = useState(pkg?.is_public ?? true);
  // Harga per cabang; kosong = pakai harga dasar.
  const [branchPrices, setBranchPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries((pkg?.branch_prices ?? []).map((bp) => [bp.branch_id, String(bp.price_idr)])),
  );
  const [form, setForm] = useState({
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    credits: String(pkg?.credits || 10),
    price_idr: String(pkg?.price_idr ?? 0),
    validity_days: String(pkg?.validity_days ?? 60),
    purchase_limit_per_member: pkg?.purchase_limit_per_member ? String(pkg.purchase_limit_per_member) : "",
    badge: pkg?.badge ?? "",
    sort_order: String(pkg?.sort_order ?? 0),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const isPass = kind === "pass";

  const save = useMutation({
    mutationFn: () =>
      gymCreditsApi.savePackage({
        id: pkg?.id,
        name: form.name.trim(),
        description: form.description,
        kind,
        credits: isPass ? 0 : Number(form.credits) || 0,
        price_idr: Number(form.price_idr) || 0,
        validity_days: Number(form.validity_days) || 0,
        purchase_limit_per_member: Number(form.purchase_limit_per_member) || null,
        applicable_class_type_ids: !isPass && coverage.length > 0 ? coverage : null,
        branch_id: pkg?.branch_id ?? null,
        is_public: isPublic,
        badge: form.badge.trim() || null,
        branch_prices: Object.entries(branchPrices)
          .filter(([, price]) => price.trim() !== "")
          .map(([branch_id, price]) => ({ branch_id, price_idr: Number(price) || 0 })),
        sort_order: Number(form.sort_order) || 0,
      }),
    onSuccess: () => {
      toast.success(pkg ? "Paket diperbarui" : "Paket dibuat", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Paket gagal disimpan", { description: error.message }),
  });

  const valid =
    form.name.trim().length >= 2 && (isPass || Number(form.credits) >= 1) && Number(form.validity_days) >= 1 && Number(form.price_idr) >= 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{pkg ? `Ubah ${pkg.name}` : "Paket baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Perubahan berlaku untuk pembelian berikutnya. Kredit yang sudah dibeli tetap memakai jumlah dan masa berlaku saat dibeli.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium text-foreground">Jenis paket</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(KIND_LABELS) as PackageKind[]).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kind === k ? "ink" : "outline"}
                    aria-pressed={kind === k}
                    disabled={Boolean(pkg?.referenced) && pkg?.kind !== k}
                    onClick={() => setKind(k)}
                  >
                    {KIND_LABELS[k]}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {isPass
                  ? "Pass: booking kelas tanpa batas selama masa berlaku, dihitung sejak pembayaran lunas."
                  : "Paket kredit: sejumlah kredit yang dipotong tiap check-in."}
              </p>
            </fieldset>
            <Field label="Nama paket" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder={isPass ? "Pass 4 Minggu" : "10 Visit Pack"} required />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            {!isPass && (
              <Field label="Jumlah kredit">
                <Input type="number" min={1} value={form.credits} onChange={set("credits")} required />
              </Field>
            )}
            <Field label="Harga dasar (Rp)">
              <Input type="number" min={0} value={form.price_idr} onChange={set("price_idr")} required />
            </Field>
            <Field label="Masa berlaku (hari)" hint="Dihitung sejak pembayaran lunas.">
              <Input type="number" min={1} value={form.validity_days} onChange={set("validity_days")} required />
            </Field>
            <Field label="Batas beli per member" hint="Kosongkan bila tanpa batas. Trial biasanya 1.">
              <Input type="number" min={1} value={form.purchase_limit_per_member} onChange={set("purchase_limit_per_member")} />
            </Field>
            <Field label="Label di situs" hint="Misalnya Paling laris. Kosongkan bila tidak perlu.">
              <Input value={form.badge} onChange={set("badge")} maxLength={40} />
            </Field>
            <Field label="Urutan tampil" hint="Angka kecil tampil lebih dulu.">
              <Input type="number" min={0} value={form.sort_order} onChange={set("sort_order")} />
            </Field>
            <div className="flex items-end">
              {isPass ? (
                <label className="flex items-center gap-3 pb-2 text-sm">
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Tampil di daftar harga situs" />
                  Tampil di daftar harga situs
                </label>
              ) : (
                <p className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
                  <Layers className="size-4" />
                  {Number(form.credits) > 0 && Number(form.price_idr) > 0
                    ? `${formatRupiah(Math.round(Number(form.price_idr) / Number(form.credits)))} per kredit`
                    : "Isi kredit dan harga"}
                </p>
              )}
            </div>
            {!isPass && (
              <label className="flex items-center gap-3 text-sm sm:col-span-2">
                <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Tampil di daftar harga situs" />
                Tampil di daftar harga situs
              </label>
            )}
            {branches.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-sm font-medium text-foreground">Harga per cabang</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {branches.map((b) => (
                    <Field key={b.id} label={b.name}>
                      <Input
                        type="number"
                        min={0}
                        placeholder={`Harga dasar ${formatRupiah(Number(form.price_idr) || 0)}`}
                        value={branchPrices[b.id] ?? ""}
                        onChange={(e) => setBranchPrices((cur) => ({ ...cur, [b.id]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Kosongkan cabang yang memakai harga dasar.</p>
              </fieldset>
            )}
            {!isPass && classTypes.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-sm font-medium text-foreground">Berlaku untuk kelas</legend>
                <div className="flex flex-wrap gap-2">
                  {classTypes.map((ct) => {
                    const on = coverage.includes(ct.id);
                    return (
                      <Button
                        key={ct.id}
                        type="button"
                        size="sm"
                        variant={on ? "ink" : "outline"}
                        aria-pressed={on}
                        onClick={() => setCoverage((cur) => (on ? cur.filter((id) => id !== ct.id) : [...cur, ct.id]))}
                      >
                        {ct.name}
                      </Button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {coverage.length === 0 ? "Tidak ada yang dipilih: kredit bisa dipakai di semua kelas." : `Hanya ${coverage.length} jenis kelas terpilih.`}
                </p>
              </fieldset>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {pkg ? "Simpan perubahan" : "Buat paket"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
