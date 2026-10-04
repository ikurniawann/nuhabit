"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { PackageCheck, Search, X, Truck } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { useReceivableGeneralPOs } from "../queries";

const STATUS_LABELS: Record<string, string> = {
  approved: "Disetujui",
  sent: "Dikirim",
  partially_received: "Diterima Sebagian",
  partial: "Diterima Sebagian",
};

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  sent: "bg-blue-100 text-blue-800",
  partially_received: "bg-amber-100 text-amber-800",
  partial: "bg-amber-100 text-amber-800",
};

export function GeneralReceiveListPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const listQuery = useReceivableGeneralPOs(search);
  const rows = listQuery.data ?? [];
  const loading = listQuery.isLoading;

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (listQuery.isError) toast.error("Gagal memuat purchase order untuk penerimaan");
  }, [listQuery.isError]);

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Penerimaan Barang"
        description="Terima barang operasional langsung dari purchase order yang disetujui atau dikirim."
      />

      <PurchasingListSection
        icon={PackageCheck}
        title="PO Menunggu Penerimaan"
        description="Purchase order barang operasional yang belum tuntas diterima. Klik Terima untuk mencatat barang masuk."
        toolbar={
          <label className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari nomor PO atau vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-white pl-10 pr-10 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-gray-400" />
              </button>
            )}
          </label>
        }
      >
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Memuat purchase order...</div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <Truck className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">Tidak ada purchase order yang menunggu penerimaan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Nomor PO</th>
                  <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                  <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                  <th className="px-4 py-3 text-center font-semibold">Item</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((po) => (
                  <tr key={po.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{po.nomor_po}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal_po, "—")}</td>
                    <td className="px-4 py-3 text-gray-900">{po.vendor_name}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{po.total_items}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={STATUS_STYLES[po.status.toLowerCase()] || "bg-gray-100 text-gray-700"}>
                        {STATUS_LABELS[po.status.toLowerCase()] || po.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        className="purchasing-main-button"
                        onClick={() => router.push(GENERAL_ROUTES.purchasingReceiveForm(po.id))}
                      >
                        <PackageCheck className="mr-2 h-4 w-4" />
                        Terima
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
