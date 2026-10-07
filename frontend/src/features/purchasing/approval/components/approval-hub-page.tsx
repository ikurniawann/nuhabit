"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ClipboardCheck, FileCheck } from "lucide-react";

const APPROVAL_CARDS = [
  {
    href: "/dashboard/purchasing/approval/pr",
    icon: ClipboardCheck,
    title: "Persetujuan PR",
    description: "Tinjau kebutuhan barang dan qty dari permintaan pembelian sebelum diproses menjadi PO.",
    accent: "text-pink-600",
    bg: "bg-pink-50",
  },
  {
    href: "/dashboard/purchasing/approval/po",
    icon: FileCheck,
    title: "Persetujuan PO",
    description: "Tinjau supplier, harga, pajak, dan total final sebelum PO dikirim.",
    accent: "text-blue-600",
    bg: "bg-blue-50",
  },
];

export function ApprovalHubPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Persetujuan Pembelian</h1>
        <p className="mt-1 text-sm text-gray-500">Pilih persetujuan yang perlu ditinjau</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {APPROVAL_CARDS.map((card) => (
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
