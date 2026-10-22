"use client";

import { Card, CardContent } from "@/components/ui/card";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";

export default function POEditPage({ params }: { params: { id: string } }) {
  return (
    <PurchasingGuard allowedRoles={["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"]}>
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Purchase Order", href: "/dashboard/purchasing/purchase-orders" },
            { label: params.id, href: `/dashboard/purchasing/purchase-orders/${params.id}` },
            { label: "Edit" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Edit PO</h1>
            <p className="text-sm text-gray-500">ID: {params.id}</p>
          </div>
          <Link href={`/dashboard/purchasing/purchase-orders/${params.id}`}>
            <Button variant="ghost">Batal</Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="text-center text-gray-400 py-12">
              <p className="text-sm">Form edit PO belum tersedia</p>
              <p className="text-xs mt-1">PATCH /api/purchasing/po/{params.id}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PurchasingGuard>
  );
}
