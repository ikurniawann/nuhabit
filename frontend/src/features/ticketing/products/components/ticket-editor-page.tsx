"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BundleTab } from "./bundle-tab";
import { CalendarTab } from "./calendar-tab";
import { InfoVariantsTab } from "./info-variants-tab";
import { PolicyTab } from "./policy-tab";
import { useProductDetail } from "../queries";

export function TicketEditorPage({ productId }: { productId: string }) {
  const detailQuery = useProductDetail(productId);
  const detail = detailQuery.data;

  if (detailQuery.isLoading || !detail) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
        <p className="mt-2 text-sm text-gray-500">Memuat ticket...</p>
      </div>
    );
  }

  const { product, channels } = detail;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
            <Link href="/dashboard/ticketing/tickets">
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          <span className="font-mono text-sm text-gray-500">{product.code}</span>
          {product.product_kind === "bundle" ? (
            <Badge className="border-0 bg-purple-100 font-normal text-purple-700">
              Paket
            </Badge>
          ) : null}
          <Badge
            className={`border-0 font-normal ${
              product.status === "active"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {product.status === "active" ? "Active" : "Draft"}
          </Badge>
          <span className="ml-auto flex gap-1">
            {channels
              .filter((channel) => channel.is_distributed)
              .map((channel) => (
                <Badge
                  key={channel.id}
                  className="border-0 bg-blue-100 font-normal text-blue-700"
                >
                  {channel.channel_code === "walk-in" ? "POS" : "Website"}
                </Badge>
              ))}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Konfigurasi produk ticket — distribusi kanal & harga per kanal
          diatur di{" "}
          <Link
            href="/dashboard/ticketing/channel-manager"
            className="text-pink-600 underline-offset-2 hover:underline"
          >
            Channel Manager
          </Link>
          .
        </p>
      </div>

      {/* flex-col eksplisit — pola repo (lihat logbook-page): tanpa ini
          TabsList jatuh ke samping konten, bukan di atas */}
      <Tabs defaultValue="info" className="w-full flex-col">
        <TabsList
          className={`grid h-9 w-full ${
            product.product_kind === "bundle"
              ? "max-w-lg grid-cols-4"
              : "max-w-md grid-cols-3"
          }`}
        >
          <TabsTrigger value="info">Info & Varian</TabsTrigger>
          {product.product_kind === "bundle" ? (
            <TabsTrigger value="bundle">Komposisi</TabsTrigger>
          ) : null}
          <TabsTrigger value="calendar">Kalender</TabsTrigger>
          <TabsTrigger value="policy">Kebijakan</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-4">
          <InfoVariantsTab detail={detail} />
        </TabsContent>
        {product.product_kind === "bundle" ? (
          <TabsContent value="bundle" className="mt-4">
            <BundleTab detail={detail} />
          </TabsContent>
        ) : null}
        <TabsContent value="calendar" className="mt-4">
          <CalendarTab detail={detail} />
        </TabsContent>
        <TabsContent value="policy" className="mt-4">
          <PolicyTab detail={detail} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
