"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  BuildingOfficeIcon,
  CubeIcon,
  ClipboardDocumentListIcon,
  ArrowDownCircleIcon,
  CheckBadgeIcon,
  ArrowUturnLeftIcon,
  ArchiveBoxIcon,
  DocumentChartBarIcon,
  ChartBarIcon,
  CalculatorIcon,
  UserGroupIcon,
  Plus,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";

const MODULE_STATS = [
  { label: "Supplier", href: RM_ROUTES.purchasingSuppliers, icon: BuildingOfficeIcon, color: "bg-blue-100 text-blue-600", desc: "Kelola data vendor & supplier" },
  { label: "Bahan Baku", href: RM_ROUTES.materials, icon: CubeIcon, color: "bg-purple-100 text-purple-600", desc: "Master bahan &amp; satuan" },
  { label: "Produk", href: PRODUCT_ROUTES.products, icon: CubeIcon, color: "bg-indigo-100 text-indigo-600", desc: "BOM &amp; struktur produk" },
  { label: "Purchase Order", href: RM_ROUTES.purchasingPo, icon: ClipboardDocumentListIcon, color: "bg-green-100 text-green-600", desc: "Kelola PO ke vendor" },
  { label: "Barang Masuk", href: RM_ROUTES.purchasingGrn, icon: ArrowDownCircleIcon, color: "bg-teal-100 text-teal-600", desc: "Delivery, GRN &amp; status barang masuk" },
  { label: "Quality Control", href: "/dashboard/purchasing/qc", icon: CheckBadgeIcon, color: "bg-yellow-100 text-yellow-600", desc: "Inspeksi &amp; QC barang" },
  { label: "Retur", href: RM_ROUTES.purchasingReturns, icon: ArrowUturnLeftIcon, color: "bg-red-100 text-red-600", desc: "Pengelolaan retur" },
  { label: "Inventori", href: "/dashboard/purchasing/inventory", icon: ArchiveBoxIcon, color: "bg-cyan-100 text-cyan-600", desc: "Stok &amp; mutasi bahan" },
  { label: "Stock Card", href: "/dashboard/purchasing/reports/stock-card", icon: ClipboardDocumentListIcon, color: "bg-violet-100 text-violet-600", desc: "Kartu stok BB & produk" },
  { label: "Inventory Valuation", href: "/dashboard/purchasing/reports/inventory-valuation", icon: ChartBarIcon, color: "bg-blue-100 text-blue-600", desc: "Nilai stok per periode" },
  { label: "PO Summary", href: "/dashboard/purchasing/reports/po-summary", icon: DocumentChartBarIcon, color: "bg-emerald-100 text-emerald-600", desc: "Ringkasan PO per periode" },
  { label: "Supplier Performance", href: "/dashboard/purchasing/reports/supplier-performance", icon: UserGroupIcon, color: "bg-violet-100 text-violet-600", desc: "Evaluasi vendor" },
  { label: "HPP Produk", href: "/dashboard/purchasing/reports/hpp-breakdown", icon: CalculatorIcon, color: "bg-pink-100 text-pink-600", desc: "Kalkulasi HPP &amp; margin" },
];

export default function PurchasingModulePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Modul Purchasing</h1>
          <p className="text-sm text-gray-500">Pengelolaan procurement &amp; supply chain</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/purchasing/reports">
            <Button variant="outline">Lihat Laporan</Button>
          </Link>
          <Link href="/dashboard/purchasing/purchase-orders/insert">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Buat PO Baru
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {MODULE_STATS.map((mod) => (
          <Link key={mod.href} href={mod.href}>
            <Card className="hover:shadow-md hover:border-gray-400 transition-all cursor-pointer h-full">
              <CardContent className="p-5 flex flex-col gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mod.color}`}>
                  <mod.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{mod.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5" dangerouslySetInnerHTML={{ __html: mod.desc }} />
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-auto">
                  <span>Akses modul</span>
                  <ArrowRightIcon className="w-3 h-3" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
