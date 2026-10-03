"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Package, Plus, Smartphone } from "lucide-react";
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
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { angka, rupiah, walletApi, type TopupPackage } from "../api";

const PACKAGES_KEY = ["wallet", "packages"];

/** POS → Member → Paket Top-up: harga, saldo diterima (termasuk bonus), masa berlaku. */
export function PackagesPage() {
  const queryClient = useQueryClient();
  const packages = useQuery({ queryKey: PACKAGES_KEY, queryFn: () => walletApi.packages() });
  const [editing, setEditing] = useState<TopupPackage | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<TopupPackage | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: PACKAGES_KEY });

  const deactivate = useMutation({
    mutationFn: (id: string) => walletApi.deactivatePackage(id),
    onSuccess: () => {
      toast.success("Paket dinonaktifkan");
      setDeactivating(null);
      refresh();
    },
    onError: (error) => toast.error("Paket gagal dinonaktifkan", { description: error.message }),
  });

  const rows = packages.data ?? [];
  const active = rows.filter((p) => p.is_active);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="POS · Member"
        title="Paket Top-up"
        description="Paket muncul di layar top-up kasir dan portal member. Selisih saldo di atas harga menjadi bonus dengan masa berlaku yang sama."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Paket baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Paket aktif" value={angka(active.length)} icon={<Package />} tone="ink" />
        <StatCard
          label="Tampil di portal"
          value={angka(active.filter((p) => p.available_online).length)}
          icon={<Smartphone />}
        />
        <StatCard
          label="Paket berbonus"
          value={angka(active.filter((p) => p.credit_idr > p.price_idr).length)}
          icon={<Gift />}
          tone="accent"
        />
      </div>

      <Card className="py-0">
        {packages.isLoading ? (
          <TableNote>Memuat paket…</TableNote>
        ) : packages.error ? (
          <TableNote tone="danger">{packages.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada paket. Kasir tetap bisa mengisi nominal bebas.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-right">Saldo diterima</TableHead>
                <TableHead className="hidden md:table-cell">Masa berlaku</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((pkg) => {
                const bonus = pkg.credit_idr - pkg.price_idr;
                return (
                  <TableRow key={pkg.id} className={pkg.is_active ? undefined : "opacity-60"}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          pkg.description,
                          pkg.branch_ids?.length ? `${pkg.branch_ids.length} cabang` : "Semua cabang",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(pkg.price_idr)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupiah(pkg.credit_idr)}
                      {bonus > 0 && <span className="block text-xs text-success">+{rupiah(bonus)} bonus</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {pkg.validity_days ? `${angka(pkg.validity_days)} hari` : "Tidak kedaluwarsa"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={pkg.is_active ? "success" : "muted"}>{pkg.is_active ? "Aktif" : "Nonaktif"}</Badge>
                        {pkg.available_online && pkg.is_active && <Badge variant="info">Portal</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(pkg)}>
                          Ubah
                        </Button>
                        {pkg.is_active && (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeactivating(pkg)}>
                            Nonaktifkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <PackageDialog pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Nonaktifkan ${deactivating?.name ?? "paket"}?`}
        description="Paket hilang dari kasir dan portal. Riwayat top-up dengan paket ini tetap tersimpan."
        confirmLabel="Nonaktifkan"
        variant="danger"
        loading={deactivate.isPending}
        onConfirm={() => deactivating && deactivate.mutate(deactivating.id)}
      />
    </div>
  );
}

function PackageDialog({ pkg, onClose, onSaved }: { pkg: TopupPackage | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    price_idr: String(pkg?.price_idr ?? 100_000),
    credit_idr: String(pkg?.credit_idr ?? 100_000),
    validity_days: pkg?.validity_days ? String(pkg.validity_days) : "",
    sort: String(pkg?.sort ?? 0),
    is_active: pkg?.is_active ?? true,
    available_online: pkg?.available_online ?? true,
    branch_ids: pkg?.branch_ids ?? [],
  });
  const branches = useQuery({ queryKey: ["wallet", "branches"], queryFn: walletApi.branches });
  const toggleBranch = (id: string) =>
    setForm((cur) => ({
      ...cur,
      branch_ids: cur.branch_ids.includes(id) ? cur.branch_ids.filter((b) => b !== id) : [...cur.branch_ids, id],
    }));
  const set = (key: "name" | "description" | "price_idr" | "credit_idr" | "validity_days" | "sort") => (
    e: React.ChangeEvent<HTMLInputElement>
  ) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const price = Number(form.price_idr) || 0;
  const credit = Number(form.credit_idr) || 0;
  const valid = form.name.trim().length >= 2 && price >= 1_000 && credit >= price;

  const save = useMutation({
    mutationFn: () =>
      walletApi.savePackage(pkg?.id ?? null, {
        name: form.name.trim(),
        description: form.description.trim(),
        price_idr: price,
        credit_idr: credit,
        validity_days: form.validity_days ? Number(form.validity_days) : null,
        is_active: form.is_active,
        available_online: form.available_online,
        branch_ids: form.branch_ids.length ? form.branch_ids : null,
        sort: Number(form.sort) || 0,
      }),
    onSuccess: () => {
      toast.success(pkg ? "Paket diperbarui" : "Paket dibuat", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Paket gagal disimpan", { description: error.message }),
  });

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
              Member membayar harga paket dan menerima saldo sebesar &ldquo;Saldo diterima&rdquo;.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama paket" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="Paket Hemat 100K" required />
            </Field>
            <Field label="Keterangan" className="sm:col-span-2">
              <Input value={form.description} onChange={set("description")} placeholder="Bonus 10% untuk member" />
            </Field>
            <Field label="Harga (Rp)">
              <Input type="number" min={1_000} step={1_000} value={form.price_idr} onChange={set("price_idr")} required />
            </Field>
            <Field label="Saldo diterima (Rp)" hint={credit > price ? `Bonus ${rupiah(credit - price)}` : "Sama dengan harga = tanpa bonus."}>
              <Input type="number" min={price} step={1_000} value={form.credit_idr} onChange={set("credit_idr")} required />
            </Field>
            <Field label="Masa berlaku (hari)" hint="Kosongkan bila saldo paket tidak kedaluwarsa.">
              <Input type="number" min={1} value={form.validity_days} onChange={set("validity_days")} placeholder="Tidak kedaluwarsa" />
            </Field>
            <Field label="Urutan tampil">
              <Input type="number" min={0} value={form.sort} onChange={set("sort")} />
            </Field>
            {(branches.data?.length ?? 0) > 1 && (
              <Field label="Dijual di kasir cabang" hint="Tidak dicentang semua = dijual di semua cabang." className="sm:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {branches.data?.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1.5 text-sm">
                      <input type="checkbox" checked={form.branch_ids.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                      {b.name}
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3 text-sm">
              Aktif
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((cur) => ({ ...cur, is_active: v }))} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3 text-sm">
              Tampil di portal member
              <Switch
                checked={form.available_online}
                onCheckedChange={(v) => setForm((cur) => ({ ...cur, available_online: v }))}
              />
            </label>
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
