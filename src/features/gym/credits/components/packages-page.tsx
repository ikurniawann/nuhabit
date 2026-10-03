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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { angka, gymCreditsApi, rupiah, type ClassTypeOption, type CreditPackage } from "../api";

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
  const active = rows.filter((p) => p.status === "active");
  const sold = rows.reduce((sum, p) => sum + p.sold_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Paket Kredit"
        description="Paket yang dijual ke member. Satu kredit = satu slot kelas sesuai biaya kelasnya. Paket yang sudah pernah dibeli hanya bisa diarsipkan."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Paket baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Paket dijual" value={angka(active.length)} icon={<Package />} tone="ink" />
        <StatCard label="Diarsipkan" value={angka(rows.length - active.length)} icon={<Archive />} />
        <StatCard label="Terjual" value={angka(sold)} unit="pembelian" icon={<ShoppingBag />} />
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
                      {p.status === "archived" && (
                        <Badge variant="muted" className="ml-2">
                          Arsip
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.purchase_limit_per_member ? `Maks. ${p.purchase_limit_per_member}× per member` : null,
                        p.applicable_class_type_ids ? `${p.applicable_class_type_ids.length} jenis kelas` : "Semua kelas",
                        p.branch_name ?? "Semua cabang",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{angka(p.credits)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupiah(p.price_idr)}
                    <span className="block text-xs text-muted-foreground">{rupiah(Math.round(p.price_idr / p.credits))}/kredit</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{angka(p.validity_days)} hari</TableCell>
                  <TableCell className="hidden lg:table-cell text-right tabular-nums">{angka(p.sold_count)}</TableCell>
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
  onClose,
  onSaved,
}: {
  pkg: CreditPackage | null;
  classTypes: ClassTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Kosong = kredit berlaku untuk semua jenis kelas.
  const [coverage, setCoverage] = useState<string[]>(pkg?.applicable_class_type_ids ?? []);
  const [form, setForm] = useState({
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    credits: String(pkg?.credits ?? 10),
    price_idr: String(pkg?.price_idr ?? 0),
    validity_days: String(pkg?.validity_days ?? 60),
    purchase_limit_per_member: pkg?.purchase_limit_per_member ? String(pkg.purchase_limit_per_member) : "",
    sort_order: String(pkg?.sort_order ?? 0),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      gymCreditsApi.savePackage({
        id: pkg?.id,
        name: form.name.trim(),
        description: form.description,
        credits: Number(form.credits) || 0,
        price_idr: Number(form.price_idr) || 0,
        validity_days: Number(form.validity_days) || 0,
        purchase_limit_per_member: Number(form.purchase_limit_per_member) || null,
        applicable_class_type_ids: coverage.length > 0 ? coverage : null,
        branch_id: pkg?.branch_id ?? null,
        sort_order: Number(form.sort_order) || 0,
      }),
    onSuccess: () => {
      toast.success(pkg ? "Paket diperbarui" : "Paket dibuat", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Paket gagal disimpan", { description: error.message }),
  });

  const valid = form.name.trim().length >= 2 && Number(form.credits) >= 1 && Number(form.validity_days) >= 1 && Number(form.price_idr) >= 0;

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
            <Field label="Nama paket" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="10 Visit Pack" required />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <Field label="Jumlah kredit">
              <Input type="number" min={1} value={form.credits} onChange={set("credits")} required />
            </Field>
            <Field label="Harga (Rp)">
              <Input type="number" min={0} value={form.price_idr} onChange={set("price_idr")} required />
            </Field>
            <Field label="Masa berlaku (hari)" hint="Dihitung sejak pembayaran lunas.">
              <Input type="number" min={1} value={form.validity_days} onChange={set("validity_days")} required />
            </Field>
            <Field label="Batas beli per member" hint="Kosongkan bila tanpa batas. Trial biasanya 1.">
              <Input type="number" min={1} value={form.purchase_limit_per_member} onChange={set("purchase_limit_per_member")} />
            </Field>
            <Field label="Urutan tampil" hint="Angka kecil tampil lebih dulu.">
              <Input type="number" min={0} value={form.sort_order} onChange={set("sort_order")} />
            </Field>
            <div className="flex items-end">
              <p className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
                <Layers className="size-4" />
                {Number(form.credits) > 0 && Number(form.price_idr) > 0
                  ? `${rupiah(Math.round(Number(form.price_idr) / Number(form.credits)))} per kredit`
                  : "Isi kredit dan harga"}
              </p>
            </div>
            {classTypes.length > 0 && (
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
