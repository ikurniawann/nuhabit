"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle,
  ClipboardList,
  CookingPot,
  Factory,
  ShoppingCart,
  Truck,
} from "lucide-react";

const PROCUREMENT_CARDS = [
  {
    href: "/dashboard/purchasing/pr",
    icon: ClipboardList,
    title: "Purchase Request",
    description: "Buat dan kelola permintaan pembelian dari departemen sebelum dibuatkan PO.",
    accent: "text-pink-600",
    bg: "bg-pink-50",
  },
  {
    href: "/dashboard/purchasing/po",
    icon: ShoppingCart,
    title: "Purchase Order",
    description: "Kelola order pembelian ke supplier berdasarkan PR yang sudah disetujui.",
    accent: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    href: "/dashboard/purchasing/grn",
    icon: Truck,
    title: "Barang Masuk",
    description: "Catat penerimaan barang dari supplier dan update progres penerimaan PO.",
    accent: "text-green-600",
    bg: "bg-green-50",
  },
  {
    href: "/dashboard/purchasing/production",
    icon: Factory,
    title: "Produksi",
    description: "Kelola kebutuhan produksi, order produksi, dan pemakaian bahan baku.",
    accent: "text-violet-600",
    bg: "bg-violet-50",
  },
  {
    href: "/dashboard/purchasing/production/recipes",
    icon: CookingPot,
    title: "Recipe/BOM",
    description: "Kelola resep produk dan komposisi bahan baku untuk perhitungan kebutuhan produksi.",
    accent: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  {
    href: "/dashboard/purchasing/qc",
    icon: CheckCircle,
    title: "QC",
    description: "Periksa kualitas barang yang diterima sebelum stok dinyatakan siap digunakan.",
    accent: "text-amber-600",
    bg: "bg-amber-50",
  },
  {
    href: "/dashboard/purchasing/returns",
    icon: ArrowLeftRight,
    title: "Retur",
    description: "Kelola retur barang ke supplier untuk item bermasalah atau tidak sesuai.",
    accent: "text-red-600",
    bg: "bg-red-50",
  },
];

export function ProcurementHubPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Procurement</h1>
        <p className="mt-1 text-sm text-gray-500">Pilih proses pembelian yang ingin dikerjakan</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {PROCUREMENT_CARDS.map((card) => (
          <Card key={card.href} className="flex h-full flex-col transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${card.bg}`}>
                  <card.icon className={`h-6 w-6 ${card.accent}`} />
                </div>
                <CardTitle className="text-lg">{card.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-4">
              <p className="flex-1 text-sm text-gray-600">{card.description}</p>
              <Link href={card.href}>
                <Button variant="outline" size="sm" className="h-10 w-full gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700">
                  Buka Menu
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
