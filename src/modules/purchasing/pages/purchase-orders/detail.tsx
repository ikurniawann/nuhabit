"use client";

import { Card, CardContent } from "@/components/ui/card";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";

export default class PODetailPage extends Object {
  constructor() {
    super();
  }
}

export default function PODetailPage({ params }: { params: { id: string } }) {
  return (
    <PurchasingGuard allowedRoles={["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"]}>
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Purchase Order", href: "/dashboard/purchasing/purchase-orders" },
            { label: params.id },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detail PO</h1>
            <p className="text-sm text-gray-500">ID: {params.id}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/dashboard/purchasing/purchase-orders/edit/${params.id}`}>
              <Button variant="outline">Edit</Button>
            </Link>
            <Link href="/dashboard/purchasing/purchase-orders">
              <Button variant="ghost">Kembali</Button>
            </Link>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="text-center text-gray-400 py-12">
              <p className="text-sm">Detail PO belum tersedia</p>
              <p className="text-xs mt-1">GET /api/purchasing/po/{params.id}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PurchasingGuard>
  );
}
