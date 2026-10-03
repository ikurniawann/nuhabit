"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageX, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, formatDateTime, formatQty, formatRupiah } from "../../shared/inventory-lookups";
import type { MovementRow } from "../../movements/types";
import { ScrapDialog } from "./scrap-dialog";

const PAGE_SIZE = 30;

/** Inventori → Scrap & Write-off: catat pengurangan stok non-penjualan + riwayatnya. */
export function InventoryScrapPage() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const scraps = useQuery({
    queryKey: ["inventory-scrap", page],
    queryFn: () =>
      fetchJson<{ data: MovementRow[]; meta: { total: number } }>(`/api/inventory/scrap?page=${page}&limit=${PAGE_SIZE}`),
  });

  const rows = scraps.data?.data ?? [];
  const total = scraps.data?.meta.total ?? 0;
  const pageValue = rows.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Inventori · Bahan Baku"
        title="Scrap & Write-off"
        description="Catat bahan yang rusak, basi, kedaluwarsa, atau dipakai sampel. Pilih batch untuk menghapus stok batch tertentu; tanpa batch, stok keluar mengikuti FEFO."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Catat scrap
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <StatCard label="Catatan scrap" value={formatQty(total)} icon={<PackageX />} tone="ink" />
        <StatCard label="Nilai di halaman ini" value={formatRupiah(pageValue)} icon={<Wallet />} tone={pageValue ? "warning" : "default"} />
      </div>

      <Card className="py-0">
        {scraps.isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Memuat riwayat scrap…</p>
        ) : scraps.error ? (
          <p className="px-5 py-10 text-center text-sm text-danger">{scraps.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Belum ada scrap. Klik Catat scrap untuk mencatat yang pertama.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bahan</TableHead>
                <TableHead className="hidden md:table-cell">Gudang</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Nilai</TableHead>
                <TableHead className="hidden lg:table-cell">Alasan</TableHead>
                <TableHead className="hidden lg:table-cell">Oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <p className="font-medium">{row.material_nama}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {row.reference_number} · {formatDateTime(row.created_at)}
                    </p>
                    {row.batch_numbers && <p className="text-xs text-muted-foreground">Batch {row.batch_numbers}</p>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{row.warehouse_nama ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(row.jumlah)} {row.satuan ?? ""}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">{formatRupiah(row.total_cost)}</TableCell>
                  <TableCell className="hidden lg:table-cell max-w-[14rem] whitespace-normal text-sm">{row.alasan}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">{row.created_by_name ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="text-muted-foreground">
            Halaman {page} / {Math.ceil(total / PAGE_SIZE)}
          </span>
          <Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}

      {creating && <ScrapDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
