"use client";

// Back-office mitra wholesale: akun mitra (buat/ubah, kata sandi sekali
// pakai), pesanan mitra, dan pengaturan produk (harga wholesale, minimal
// qty, pre-order).

import { useState } from "react";
import { Briefcase, Copy, KeyRound, Loader2, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { ShopOrdersPage } from "@/features/shop/orders";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import {
  useWholesaleAccounts,
  useWholesaleProducts,
  type WholesaleAccount,
  type WholesaleAccountResult,
  type WholesaleProductRow,
} from "../queries";
import { AccountFormModal } from "./account-form-modal";
import { ProductSettingsModal } from "./product-settings-modal";

const TERMS = { invoice: "Invoice Xendit", pay_later: "Bayar nanti" } as const;

export function ShopWholesalePage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Mitra Wholesale"
        description="Akun gym mitra dan reseller, pesanan B2B mereka, dan harga wholesale per produk."
      />
      <Tabs defaultValue="accounts" className="w-full flex-col">
        <TabsList className="grid h-9 w-full max-w-md grid-cols-3">
          <TabsTrigger value="accounts">Akun Mitra</TabsTrigger>
          <TabsTrigger value="orders">Pesanan</TabsTrigger>
          <TabsTrigger value="products">Produk</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="orders" className="mt-4">
          <ShopOrdersPage wholesale />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <ProductsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountsTab() {
  const accounts = useWholesaleAccounts();
  const rows = accounts.data ?? [];
  const [editing, setEditing] = useState<WholesaleAccount | null | "new">(null);
  const [issued, setIssued] = useState<WholesaleAccountResult | null>(null);

  const onSaved = (result: WholesaleAccountResult) => {
    setEditing(null);
    if (result.password) setIssued(result);
    else toast.success("Akun mitra tersimpan");
  };

  return (
    <>
      <PurchasingListSection
        icon={Briefcase}
        title="Akun Mitra"
        description={`${rows.length} akun`}
        toolbar={
          <Button type="button" size="sm" className="h-9" onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 h-4 w-4" />
            Akun baru
          </Button>
        }
      >
        {accounts.isPending ? (
          <div className="flex justify-center px-4 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-forest" />
          </div>
        ) : accounts.isError ? (
          <p className="px-4 py-16 text-center text-sm text-danger">{accounts.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">Belum ada akun mitra</p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Perusahaan</th>
                  <th className="px-4 py-3 text-left font-semibold">Kontak</th>
                  <th className="px-4 py-3 text-right font-semibold">Diskon</th>
                  <th className="px-4 py-3 text-right font-semibold">Min. pesanan</th>
                  <th className="px-4 py-3 text-left font-semibold">Termin</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Masuk terakhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((account) => (
                  <tr key={account.id} onClick={() => setEditing(account)} className="cursor-pointer hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{account.company_name}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{account.contact_name}</p>
                      <p className="text-xs text-gray-400">
                        {account.email}
                        {account.phone ? ` · ${account.phone}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">{account.discount_pct}%</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(account.min_order_idr)}</td>
                    <td className="px-4 py-3 text-gray-600">{TERMS[account.payment_terms]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          account.status === "active" ? "bg-success-soft text-success" : "bg-surface text-muted-foreground"
                        }`}
                      >
                        {account.status === "active" ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {account.last_login_at ? formatDateTime(account.last_login_at) : "Belum pernah"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {editing !== null ? (
        <AccountFormModal
          key={editing === "new" ? "new" : editing.id}
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}

      {issued ? <PasswordDialog account={issued} onClose={() => setIssued(null)} /> : null}
    </>
  );
}

/** Kata sandi sekali pakai: tampil satu kali, tidak disimpan di mana pun. */
function PasswordDialog({ account, onClose }: { account: WholesaleAccountResult; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${account.email}\n${account.password ?? ""}`);
      toast.success("Email dan kata sandi disalin");
    } catch {
      toast.error("Tidak bisa menyalin; catat manual");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Kata sandi mitra</DialogPanelTitle>
          <DialogPanelDescription>
            Kirim ke {account.contact_name} ({account.company_name}). Kata sandi ini hanya tampil sekali.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="rounded-2xl bg-surface p-4">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-mono text-sm">{account.email}</p>
            <p className="mt-3 text-xs text-muted-foreground">Kata sandi</p>
            <p className="flex items-center gap-2 font-mono text-lg font-semibold">
              <KeyRound className="h-4 w-4 text-forest" />
              {account.password}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Masuk di /wholesale. Reset dari form akun bila hilang.</p>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy}>
            <Copy className="mr-1.5 h-4 w-4" />
            Salin
          </Button>
          <Button type="button" onClick={onClose}>
            Selesai
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function ProductsTab() {
  const products = useWholesaleProducts();
  const rows = products.data ?? [];
  const [editing, setEditing] = useState<WholesaleProductRow | null>(null);

  return (
    <>
      <PurchasingListSection icon={Package} title="Produk Toko Online" description={`${rows.length} produk di kanal web`}>
        {products.isPending ? (
          <div className="flex justify-center px-4 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-forest" />
          </div>
        ) : products.isError ? (
          <p className="px-4 py-16 text-center text-sm text-danger">{products.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            Belum ada produk merchandise yang didistribusikan ke kanal web
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Produk</th>
                  <th className="px-4 py-3 text-right font-semibold">Retail</th>
                  <th className="px-4 py-3 text-right font-semibold">Wholesale</th>
                  <th className="px-4 py-3 text-right font-semibold">Min. qty</th>
                  <th className="px-4 py-3 text-right font-semibold">Stok</th>
                  <th className="px-4 py-3 text-left font-semibold">Pre-order</th>
                  <th className="px-4 py-3 text-left font-semibold">Promo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((product) => (
                  <tr key={product.id} onClick={() => setEditing(product)} className="cursor-pointer hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-400">{product.collection ?? "Tanpa koleksi"}</p>
                    </td>
                    <td className="px-4 py-3 text-right">{formatRupiah(product.price)}</td>
                    <td className="px-4 py-3 text-right">
                      {product.wholesale_price_idr === null ? (
                        <span className="text-xs text-gray-400">ikut diskon</span>
                      ) : (
                        formatRupiah(product.wholesale_price_idr)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{product.wholesale_min_qty}</td>
                    <td className="px-4 py-3 text-right">{product.stock}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {product.preorder_until ? `sampai ${formatDate(product.preorder_until)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {product.sale_price_idr === null ? "—" : formatRupiah(product.sale_price_idr)}
                      {product.sale_until && product.sale_price_idr !== null ? (
                        <span className="block text-xs text-gray-400">sampai {formatDate(product.sale_until)}</span>
                      ) : null}
                      {product.is_featured || product.is_new ? (
                        <span className="block text-xs text-gray-400">{[product.is_featured ? "unggulan" : null, product.is_new ? "baru" : null].filter(Boolean).join(", ")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
      {editing ? <ProductSettingsModal key={editing.id} product={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
