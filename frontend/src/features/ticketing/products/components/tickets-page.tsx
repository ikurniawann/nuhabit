"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatRupiah } from "@/lib/format";
import { CategoryAutocomplete } from "./category-autocomplete";
import { useCreateProduct, useProducts } from "../queries";
import type {
  PassEntryPolicy,
  TicketProductKind,
  TicketVariantPreset,
} from "../types";

export function TicketsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TicketProductKind>("single");
  const [variantPreset, setVariantPreset] =
    useState<TicketVariantPreset>("adult-child");
  const [categoryName, setCategoryName] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [cogs, setCogs] = useState("");
  const [hasGate, setHasGate] = useState(true);
  // EPIC-028 — konfigurasi season pass
  const [validityMonths, setValidityMonths] = useState("12");
  const [entryPolicy, setEntryPolicy] =
    useState<PassEntryPolicy>("once_per_day");
  const [visitQuota, setVisitQuota] = useState("");
  const [memberDiscount, setMemberDiscount] = useState("");

  const productsQuery = useProducts(q);
  const products = productsQuery.data ?? [];

  const createMutation = useCreateProduct((result) => {
    setCreateOpen(false);
    setName("");
    setKind("single");
    setVariantPreset("adult-child");
    setCategoryName("");
    setBasePrice("");
    setCogs("");
    setHasGate(true);
    setValidityMonths("12");
    setEntryPolicy("once_per_day");
    setVisitQuota("");
    setMemberDiscount("");
    router.push(`/dashboard/ticketing/tickets/${result.id}`);
  });

  const isPass = kind === "season_pass";
  const passQuotaMissing =
    isPass && entryPolicy === "limited_visits" && !(Number(visitQuota) > 0);

  const handleCreate = () => {
    if (!name.trim() || createMutation.isPending || passQuotaMissing) return;
    createMutation.mutate({
      name: name.trim(),
      product_kind: kind,
      variant_preset: variantPreset,
      category_name: categoryName.trim() || null,
      base_price: Number(basePrice) || 0,
      cogs: Number(cogs) || 0,
      has_gate: hasGate,
      status: "draft",
      ...(isPass
        ? {
            validity_months: Number(validityMonths) || 12,
            entry_policy: entryPolicy,
            visit_quota:
              entryPolicy === "limited_visits" ? Number(visitQuota) : null,
            member_discount_percent: Number(memberDiscount) || 0,
          }
        : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Master Ticket</h1>
        <p className="mt-1 text-sm text-gray-500">
          Produk tiket theme park: varian Adult/Child ber-harga musiman,
          kalender per ticket, dan kebijakan operasional. Distribusi kanal
          diatur di Channel Manager.
        </p>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title="Daftar Ticket"
        description="Ticket Draft belum bisa dijual — aktifkan setelah harga varian lengkap."
        toolbar={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Cari nama / kode…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-48"
            />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Buat Ticket
            </Button>
          </div>
        }
      >
        {productsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat ticket...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Ticket</th>
                  <th className="px-4 py-3 text-left font-semibold">Kategori</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Base Price</th>
                  <th className="px-4 py-3 text-left font-semibold">Distribusi</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {products.map((product) => (
                  <TableRow key={product.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.thumbnail_url}
                            alt=""
                            className="h-10 w-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                            <TicketIcon className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900">
                            {product.name}
                            {product.product_kind === "bundle" ? (
                              <Badge className="ml-2 border-0 bg-purple-100 font-normal text-purple-700">
                                Paket
                              </Badge>
                            ) : product.product_kind === "season_pass" ? (
                              <Badge className="ml-2 border-0 bg-emerald-100 font-normal text-emerald-700">
                                Season Pass
                              </Badge>
                            ) : null}
                            {!product.has_gate && (
                              <Badge className="ml-2 border-0 bg-sky-100 font-normal text-sky-700">
                                Tanpa Gate
                              </Badge>
                            )}
                          </p>
                          <p className="font-mono text-xs text-gray-500">
                            {product.code}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {product.category_name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${
                          product.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {product.status === "active" ? "Active" : "Draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {formatRupiah(product.base_price)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {product.distributed_channels.length === 0 ? (
                          <span className="text-xs text-gray-400">
                            belum didistribusi
                          </span>
                        ) : (
                          product.distributed_channels.map((channel) => (
                            <Badge
                              key={channel}
                              className="border-0 bg-blue-100 font-normal text-blue-700"
                            >
                              {channel === "walk-in" ? "POS" : "Website"}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          asChild
                        >
                          <Link href={`/dashboard/ticketing/tickets/${product.id}`}>
                            Kelola
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
                {products.length === 0 ? (
                  <TableRow>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                      Belum ada ticket — klik “Buat Ticket” untuk memulai.
                    </td>
                  </TableRow>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Ticket Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Jenis</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as TicketProductKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">
                    Tiket satuan — dijual per orang
                  </SelectItem>
                  <SelectItem value="bundle">
                    Paket bundling — gabungan beberapa tiket satuan
                  </SelectItem>
                  <SelectItem value="season_pass">
                    Season Pass — pass masuk berlaku (annual/berkala)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPass ? (
              <div className="space-y-4 rounded-xl border border-pink-100 bg-pink-50/50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pass_validity">Masa berlaku (bulan)</Label>
                    <Input
                      id="pass_validity"
                      type="number"
                      min={1}
                      max={120}
                      value={validityMonths}
                      onChange={(e) => setValidityMonths(e.target.value)}
                    />
                    <p className="text-[11px] text-gray-500">
                      Rolling sejak pembelian (mis. 12 = annual).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kebijakan masuk</Label>
                    <Select
                      value={entryPolicy}
                      onValueChange={(v) => setEntryPolicy(v as PassEntryPolicy)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="once_per_day">
                          1× per hari
                        </SelectItem>
                        <SelectItem value="unlimited">
                          Tak terbatas
                        </SelectItem>
                        <SelectItem value="limited_visits">
                          Jatah kunjungan (punch card)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {entryPolicy === "limited_visits" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pass_quota">Jatah kunjungan *</Label>
                    <Input
                      id="pass_quota"
                      type="number"
                      min={1}
                      max={1000}
                      placeholder="mis. 10"
                      value={visitQuota}
                      onChange={(e) => setVisitQuota(e.target.value)}
                    />
                    {passQuotaMissing && (
                      <p className="text-[11px] text-red-600">
                        Wajib diisi untuk pass punch-card.
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="pass_discount">Diskon member di POS (%)</Label>
                  <Input
                    id="pass_discount"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={memberDiscount}
                    onChange={(e) => setMemberDiscount(e.target.value)}
                  />
                  <p className="text-[11px] text-gray-500">
                    Benefit: pemegang pass aktif dapat diskon ini di kasir POS
                    (0 = tanpa benefit).
                  </p>
                </div>
              </div>
            ) : null}
            {kind === "single" ? (
              <div className="space-y-1.5">
                <Label>Varian</Label>
                <Select
                  value={variantPreset}
                  onValueChange={(v) =>
                    setVariantPreset(v as TicketVariantPreset)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adult-child">
                      Adult & Child — harga beda per kategori
                    </SelectItem>
                    <SelectItem value="umum">
                      Umum — satu harga berlaku semua umur
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="ticket_name">Nama Ticket *</Label>
              <Input
                id="ticket_name"
                placeholder={
                  kind === "bundle"
                    ? "mis. Paket Keluarga (2 Dewasa + 2 Anak)"
                    : isPass
                      ? "mis. Annual Pass Reguler"
                      : "mis. Tiket Masuk Reguler"
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <CategoryAutocomplete value={categoryName} onChange={setCategoryName} />
              <p className="text-xs text-gray-500">
                Ketik nama baru → kategori otomatis ditambahkan
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket_base_price">Base Price (Rp)</Label>
                <Input
                  id="ticket_base_price"
                  type="number"
                  min={0}
                  step={5000}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket_cogs">COGS / HPP (Rp)</Label>
                <Input
                  id="ticket_cogs"
                  type="number"
                  min={0}
                  step={1000}
                  value={cogs}
                  onChange={(e) => setCogs(e.target.value)}
                />
                <p className="text-[11px] text-gray-500">
                  Harga pokok → laporan omzet kotor vs bersih.
                </p>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 p-3">
              <div>
                <Label htmlFor="ticket_has_gate" className="cursor-pointer">
                  Punya gate?
                </Label>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {hasGate
                    ? "Divalidasi di gate/turnstile."
                    : "Tanpa gate — penjaga keliling cek dengan reader NFC."}
                </p>
              </div>
              <Switch
                id="ticket_has_gate"
                checked={hasGate}
                onCheckedChange={setHasGate}
              />
            </div>
            <p className="text-xs text-gray-500">
              {kind === "bundle"
                ? "Paket dibuat berstatus Draft dengan satu varian “Paket” — susun komposisi & harga paket di halaman berikutnya sebelum diaktifkan."
                : isPass
                  ? "Season Pass dibuat berstatus Draft dengan satu varian “Umum” penampung harga — lengkapi harga di halaman berikutnya, lalu aktifkan. Penjualan pass menyusul (loket & online)."
                  : variantPreset === "umum"
                    ? "Ticket dibuat berstatus Draft dengan satu varian “Umum” (berlaku semua umur) — lengkapi harga, kalender, dan kebijakan di halaman berikutnya."
                    : "Ticket dibuat berstatus Draft dengan varian Adult & Child — lengkapi harga, kalender, dan kebijakan di halaman berikutnya."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                !name.trim() || createMutation.isPending || passQuotaMissing
              }
            >
              {createMutation.isPending ? "Membuat…" : "Buat & Konfigurasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
