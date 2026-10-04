"use client";

// EPIC-026 B1 — halaman master barang operasional (scope 'general').
// List + dialog buat/ubah + hapus. Flag `stockable` menentukan apakah barang
// dilacak stok (spare part) atau di-expense saat diterima (ATK).

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, Pencil, Trash2, Package } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSupplyItemList, useSupplyItemFormDeps } from "../queries";
import { useDeleteSupplyItem } from "../mutations";
import type { SupplyItem } from "../types";
import { SupplyItemFormDialog } from "./supply-item-form-dialog";
import { formatRupiah } from "@/lib/format";

export function SupplyItemsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyItem | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SupplyItem | null>(null);
  const perPage = 20;

  const listParams = useMemo(
    () => ({ search, page, limit: perPage }),
    [search, page]
  );
  const listQuery = useSupplyItemList(listParams);
  const depsQuery = useSupplyItemFormDeps();
  const deleteMutation = useDeleteSupplyItem();

  const items = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const categories = depsQuery.data?.categories ?? [];
  const units = depsQuery.data?.units ?? [];

  const openDialog = (item: SupplyItem | null) => {
    setEditing(item);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };
  const openCreate = () => openDialog(null);
  const openEdit = (item: SupplyItem) => openDialog(item);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success("Barang dihapus");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus");
    }
  };

  const categoryName = (code: string | null) =>
    code ? categories.find((c) => c.code === code)?.nama ?? code : "-";
  const unitName = (id: string | null) =>
    id ? units.find((u) => u.id === id)?.nama ?? "-" : "-";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Barang Operasional</h1>
          <p className="mt-1 text-sm text-gray-500">
            Master ATK, spare part & consumable — {total} barang
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/items/general/categories">
            <Button variant="outline" size="sm">Kategori</Button>
          </Link>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Tambah Barang
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari kode / nama barang..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Harga Beli</TableHead>
                <TableHead className="text-center">Tipe</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-20 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-gray-500">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-gray-500">
                    <Package className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    Belum ada barang operasional. Klik &quot;Tambah Barang&quot;.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50">
                    <TableCell className="font-mono text-xs text-gray-600">{item.kode}</TableCell>
                    <TableCell className="font-medium text-gray-900">{item.nama}</TableCell>
                    <TableCell className="text-gray-700">{categoryName(item.kategori)}</TableCell>
                    <TableCell className="text-gray-700">{unitName(item.satuan_id)}</TableCell>
                    <TableCell className="text-right tabular-nums text-gray-900">
                      {formatRupiah(item.harga_beli)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          item.stockable
                            ? "border-0 bg-blue-100 text-blue-700"
                            : "border-0 bg-gray-100 text-gray-600"
                        }
                      >
                        {item.stockable ? "Stok" : "Expense"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          item.is_active
                            ? "border-0 bg-emerald-100 text-emerald-700"
                            : "border-0 bg-gray-100 text-gray-500"
                        }
                      >
                        {item.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
              <span>Hal {page} dari {totalPages} ({total} barang)</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Sebelumnya
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Berikutnya
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SupplyItemFormDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        categories={categories}
        units={units}
      />

      {/* Konfirmasi hapus */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus Barang</DialogTitle>
            <DialogDescription>
              Hapus <span className="font-medium text-gray-900">{deleteTarget?.nama}</span>? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
