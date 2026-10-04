"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { defaultPurchasePackFor, wholePacksFor } from "@/lib/purchasing/packs";
import type { POFormData } from "../../api";

/**
 * PO hanya bisa dibuat dari PR yang disetujui. Dari laporan stok rendah (?material_id=&qty=)
 * halaman ini menyarankan qty kemasan dan membuka form PR untuk bahan itu.
 */
export function PORequiresPR({ lookups }: { lookups: POFormData }) {
  const searchParams = useSearchParams();
  const material = lookups.materials.find((m) => m.id === searchParams.get("material_id"));
  const baseQty = Number(searchParams.get("qty")) || 0;
  const pack = material ? defaultPurchasePackFor(material) : undefined;
  const packQty = wholePacksFor(baseQty, pack?.qty_in_base_unit ?? 1);
  const packUnit = lookups.units.find((unit) => unit.id === pack?.satuan_id)?.nama || material?.satuan_besar_nama;
  const prHref = material
    ? `/dashboard/purchasing/pr/insert?${new URLSearchParams({ material_id: material.id, qty: String(baseQty) })}`
    : null;

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.purchasingPo}
        title="Buat Purchase Order"
        description="Purchase order hanya bisa dibuat dari purchase request yang sudah disetujui"
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-50 text-pink-600">
            <ClipboardList className="h-6 w-6" />
          </div>
          {material && packQty > 0 && (
            <div className="w-full max-w-md rounded-xl bg-muted px-4 py-3 text-left text-sm">
              <p className="font-medium text-gray-900">Saran pemesanan ulang dari laporan stok rendah</p>
              <p className="mt-1 text-gray-600">
                {material.nama}: {packQty} {packUnit} ({baseQty} satuan dasar)
              </p>
            </div>
          )}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Mulai dari Purchase Request</h2>
            <p className="max-w-md text-sm text-gray-500">
              Buka purchase request yang sudah disetujui lalu gunakan &quot;Buat Purchase Order&quot; untuk memulai PO
              baru. Pembuatan purchase order secara langsung tidak tersedia di halaman ini.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href={RM_ROUTES.purchasingPo}>
              <Button variant="outline" className="h-10 w-full sm:w-auto">
                Kembali ke Purchase Order
              </Button>
            </Link>
            <Link href={prHref ?? RM_ROUTES.purchasingPr}>
              <Button className="h-10 w-full bg-pink-600 hover:bg-pink-700 sm:w-auto">
                {prHref ? "Buat Purchase Request" : "Buka Purchase Request"}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
