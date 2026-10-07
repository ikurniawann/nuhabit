"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClipboardDocumentCheckIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { useGrnList } from "../queries";
import { useDeleteGrn } from "../mutations";
import type { GrnStatus, GrnListRow } from "../types";

const STATUS_COLORS: Record<GrnStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  partially_received: "bg-orange-100 text-orange-800",
  received: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<GrnStatus, string> = {
  pending: "Menunggu",
  partially_received: "Diterima Sebagian",
  received: "Diterima",
  rejected: "Ditolak",
};

export function GrnContinueListPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 15;

  const listQuery = useGrnList({ page, limit, search: appliedSearch || undefined });
  const loading = listQuery.isLoading;
  // Hanya GRN yang belum selesai QC/posting. Sisa PO setelah GRN partial
  // dilanjutkan lewat Kirim Ulang + GRN baru, bukan "continue" GRN lama.
  const grns = (listQuery.data?.data ?? []).filter(
    (g: GrnListRow) => g.status === "pending"
  );
  const totalPages = Math.ceil((listQuery.data?.total ?? 0) / limit);

  const deleteMutation = useDeleteGrn();

  useEffect(() => {
    if (listQuery.isError) toast.error("Gagal memuat data GRN");
  }, [listQuery.isError]);

  function applySearch() {
    setAppliedSearch(search.trim());
    setPage(1);
  }

  async function handleDelete(id: string, nomorGrn: string) {
    if (!confirm(`Yakin ingin menghapus GRN ${nomorGrn}?`)) return;

    try {
      const data = await deleteMutation.mutateAsync(id);
      toast.success(data.message || "GRN berhasil dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus GRN");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lanjutkan Penerimaan Barang</h1>
          <p className="text-sm text-gray-500">
            GRN berstatus menunggu (belum QC). Sisa qty PO setelah penerimaan sebagian → Kirim Ulang di detail PO.
          </p>
        </div>
        <Link href="/dashboard/purchasing/grn">
          <Button variant="outline">
            <PlusIcon className="w-4 h-4 mr-2" />
            Input Penerimaan Baru
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardDocumentCheckIcon className="w-5 h-5" />
            Filter Pencarian
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Cari nomor GRN / surat jalan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="pl-9"
            />
          </div>
          <Button onClick={applySearch}>Cari</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardDocumentCheckIcon className="w-5 h-5" />
            GRN yang Dapat Dilanjutkan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {[
                    "No. GRN",
                    "Supplier",
                    "No. Surat Jalan",
                    "PO",
                    "Tgl Terima",
                    "Status",
                    "Item Diterima",
                    "Aksi",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left py-3 px-4 text-sm font-medium text-gray-700"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-400">
                      Memuat...
                    </td>
                  </tr>
                ) : grns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400">
                      <ClipboardDocumentCheckIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>Tidak ada GRN yang perlu dilanjutkan</p>
                      <p className="text-xs mt-1">
                        Sisa qty setelah penerimaan sebagian: gunakan Kirim Ulang di detail PO, lalu buat GRN baru.
                      </p>
                    </td>
                  </tr>
                ) : (
                  grns.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-mono font-medium text-pink-600">
                        {g.nomor_grn}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium">
                        {g.supplier_name || "—"}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {g.no_surat_jalan || "—"}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {g.po_number || "—"}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {formatDate(g.tanggal_penerimaan)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[g.status]}`}
                        >
                          {STATUS_LABELS[g.status]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {g.total_item_diterima || 0}
                        {g.total_item_ditolak > 0 && (
                          <span className="text-red-500 ml-1">
                            ({g.total_item_ditolak} ditolak)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Link href={`/dashboard/purchasing/grn/${g.id}`}>
                            <Button variant="ghost" size="sm" title="Lihat Detail">
                              <EyeIcon className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Link href={`/dashboard/purchasing/grn/continue/${g.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs px-2"
                              title="Lanjutkan Penerimaan"
                            >
                              <PencilIcon className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(g.id, g.nomor_grn)}
                            className="text-red-600 hover:bg-red-50"
                            title="Hapus GRN"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Sebelumnya
              </Button>
              <span className="py-2 px-4 text-sm text-gray-600">
                Halaman {page} dari {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
