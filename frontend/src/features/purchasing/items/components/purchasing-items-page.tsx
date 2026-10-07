"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_NAV_GROUPS,
  RAW_MATERIAL_NAV_GROUPS,
} from "@/features/purchasing/items/items-nav";
import {
  ArrowRight,
  Box,
  CheckCircle,
  ClipboardList,
  Factory,
  Package,
  ShoppingCart,
  Warehouse,
} from "lucide-react";

const RAW_MATERIAL_GROUP_ICONS = {
  "Data Master": Package,
  Inventory: Warehouse,
  Purchasing: ShoppingCart,
  Approval: CheckCircle,
  Production: Factory,
} as const;

const PRODUCT_GROUP_ICONS = {
  "Master Data": Box,
  Inventory: Warehouse,
  Purchasing: ShoppingCart,
  Approval: CheckCircle,
  Production: Factory,
} as const;

function NavGroupCards({
  groups,
  icons,
}: {
  groups: typeof RAW_MATERIAL_NAV_GROUPS;
  icons: Record<string, typeof Package>;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const Icon = icons[group.label as keyof typeof icons] ?? ClipboardList;
        return (
          <Card key={group.label} className="flex h-full flex-col border-gray-200/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-pink-50 p-2">
                  <Icon className="h-5 w-5 text-pink-600" />
                </div>
                <CardTitle className="text-base">{group.label}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2">
              {group.items.map((item) => (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-between border-gray-200/80 text-gray-800 hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
                  >
                    {item.label}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function PurchasingItemsPage() {
  return (
    <div className="space-y-8">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Items</h1>
        <p className="mt-1 text-sm text-gray-500">
          Kelola master bahan baku, inventori, pembelian, dan produksi
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-pink-600" />
          <h2 className="text-lg font-semibold text-gray-900">Bahan Baku</h2>
        </div>

        <NavGroupCards groups={RAW_MATERIAL_NAV_GROUPS} icons={RAW_MATERIAL_GROUP_ICONS} />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Product</h2>
        </div>

        <NavGroupCards groups={PRODUCT_NAV_GROUPS} icons={PRODUCT_GROUP_ICONS} />
      </section>
    </div>
  );
}
