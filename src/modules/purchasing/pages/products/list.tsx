"use client";

import { Card, CardContent } from "@/components/ui/card";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";

export default function ProductsListPage() {
  return (
    <PurchasingGuard allowedRoles={["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"]}>
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Produk" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Produk</h1>
            <p className="text-sm text-gray-500">Master produk &amp; Bill of Materials</p>
          </div>
          <Link href="/dashboard/purchasing/products/insert">
            <Button>+ Tambah Produk</Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="text-center text-gray-400 py-12">
              <p className="text-sm">Daftar produk belum tersedia</p>
              <p className="text-xs mt-1">Page stub — implementasikan dengan API call</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PurchasingGuard>
  );
}
