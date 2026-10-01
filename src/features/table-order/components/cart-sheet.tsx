"use client";

import { Coins, Loader2, Minus, Plus, QrCode, ScanLine, ShoppingBag, WalletCards } from "lucide-react";
import { idrToArkDisplay } from "@/lib/pos/loyalty-settings";
import { formatRupiah } from "@/lib/table-order/menu";
import type { TableOrderPaymentMethod, TableOrderType } from "@/lib/table-order/order-status";
import { memberPrice, type CartLine, type CartSummary } from "@/lib/table-order/pricing";
import type { MemberProfile, TableSession } from "../api";
import { BottomSheet } from "./sheet";

export function CartSheet({
  open,
  onClose,
  cart,
  summary,
  session,
  member,
  orderType,
  onOrderType,
  paymentMethod,
  onPaymentMethod,
  note,
  onNote,
  contactLabel,
  onEditContact,
  onQuantity,
  onOpenMember,
  submitting,
  error,
  onSubmit,
  arkEnabled = true,
  xpEnabled = true,
}: {
  /** Saklar CRM → Pengaturan: sembunyikan opsi ARK Coin / info XP bila mati. */
  arkEnabled?: boolean;
  xpEnabled?: boolean;
  open: boolean;
  onClose: () => void;
  cart: CartLine[];
  summary: CartSummary;
  session: TableSession | null;
  member: MemberProfile | null;
  orderType: TableOrderType;
  onOrderType: (type: TableOrderType) => void;
  paymentMethod: TableOrderPaymentMethod;
  onPaymentMethod: (method: TableOrderPaymentMethod) => void;
  note: string;
  onNote: (value: string) => void;
  /** Ringkasan data pemesan; null = belum diisi (pesanan tidak bisa dikirim). */
  contactLabel: string | null;
  onEditContact: () => void;
  onQuantity: (cartId: string, delta: number) => void;
  onOpenMember: () => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const qrisAvailable = session?.qris_available ?? false;
  const staticQrisAvailable = Boolean(session?.static_qris_available && session.static_qris_image_url);
  const arkEnough = member ? member.ark_coin_balance >= summary.total : false;
  const canSubmit =
    cart.length > 0 &&
    Boolean(contactLabel) &&
    !submitting &&
    (paymentMethod !== "ark_coin" || (Boolean(member) && arkEnough)) &&
    (paymentMethod !== "qris" || qrisAvailable) &&
    (paymentMethod !== "static_qris" || staticQrisAvailable);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Keranjang"
      footer={
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-sm disabled:bg-gray-300"
        >
          <span className="flex items-center gap-2">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {paymentMethod === "qris" || paymentMethod === "static_qris"
              ? "Pesan & bayar QRIS"
              : paymentMethod === "ark_coin"
                ? "Pesan & bayar ARK Coin"
                : "Kirim pesanan"}
          </span>
          <span>{formatRupiah(summary.total)}</span>
        </button>
      }
    >
      {cart.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <ShoppingBag className="size-10 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-700">Keranjang masih kosong</p>
          <p className="mt-1 text-xs text-gray-500">Pilih menu favorit Anda dari daftar.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 rounded-full bg-gray-100 p-1 text-sm font-semibold">
            {(
              [
                ["dine_in", "Makan di tempat"],
                ["takeaway", "Bawa pulang"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onOrderType(value)}
                className={`h-9 rounded-full transition ${
                  orderType === value ? "bg-primary text-white shadow" : "text-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200">
            {cart.map((line) => (
              <div key={line.cartId} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">{line.name}</div>
                  {line.modifierNames?.length ? (
                    <div className="mt-0.5 truncate text-xs text-gray-600">+ {line.modifierNames.join(", ")}</div>
                  ) : null}
                  <div className="mt-0.5 text-xs text-gray-500">
                    {line.variantName ? `${line.variantName} · ` : ""}
                    {formatRupiah(line.unitPrice)}
                    {xpEnabled && line.xp > 0 ? ` · +${line.xp} XP` : ""}
                  </div>
                </div>
                <div className="inline-flex h-8 items-center rounded-full border border-primary">
                  <button
                    type="button"
                    onClick={() => onQuantity(line.cartId, -1)}
                    className="flex size-8 items-center justify-center text-primary"
                    aria-label={`Kurangi ${line.name}`}
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="min-w-6 text-center text-sm font-bold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onQuantity(line.cartId, 1)}
                    className="flex size-8 items-center justify-center text-primary"
                    aria-label={`Tambah ${line.name}`}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <div className="w-20 text-right text-sm font-bold text-gray-900">
                  {summary.memberDiscountPercent > 0 ? (
                    <>
                      <div className="text-[11px] font-medium text-gray-400 line-through">
                        {formatRupiah(line.unitPrice * line.quantity)}
                      </div>
                      <div className="text-primary">
                        {formatRupiah(memberPrice(line.unitPrice, summary.memberDiscountPercent) * line.quantity)}
                      </div>
                    </>
                  ) : (
                    formatRupiah(line.unitPrice * line.quantity)
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 ${
                contactLabel ? "border-gray-200" : "border-amber-300 bg-amber-50"
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-700">Pemesan</div>
                <div className={`truncate text-sm ${contactLabel ? "text-gray-900" : "font-semibold text-amber-700"}`}>
                  {contactLabel ?? "Isi nomor WhatsApp & nama dulu"}
                </div>
              </div>
              {!member && (
                <button type="button" onClick={onEditContact} className="shrink-0 text-xs font-semibold text-primary">
                  {contactLabel ? "Ubah" : "Isi sekarang"}
                </button>
              )}
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-gray-700">Catatan untuk dapur (opsional)</span>
              <textarea
                value={note}
                onChange={(event) => onNote(event.target.value.slice(0, 300))}
                rows={2}
                placeholder="Contoh: tidak pedas, tanpa es"
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-primary"
              />
            </label>
          </div>

          <div className="rounded-2xl bg-gray-50 p-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal ({summary.totalItems} item)</span>
              <span className="font-semibold text-gray-900">{formatRupiah(summary.subtotal)}</span>
            </div>
            {summary.memberDiscount > 0 && (
              <div className="mt-1.5 flex justify-between text-primary">
                <span>
                  Diskon member{member?.tier?.name ? ` ${member.tier.name}` : ""} ({summary.memberDiscountPercent}%)
                </span>
                <span className="font-semibold">−{formatRupiah(summary.memberDiscount)}</span>
              </div>
            )}
            {summary.breakdown.map((line) => (
              <div key={line.code} className="mt-1.5 flex justify-between text-gray-600">
                <span>
                  {line.name}
                  {line.rate != null ? ` (${line.rate}%)` : ""}
                </span>
                <span className="font-semibold text-gray-900">{formatRupiah(line.amount)}</span>
              </div>
            ))}
            {xpEnabled && summary.totalXp > 0 && (
              <div className="mt-1.5 flex justify-between text-amber-600">
                <span>XP didapat</span>
                <span className="font-semibold">+{summary.totalXp} XP</span>
              </div>
            )}
            <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 text-base font-bold text-gray-900">
              <span>Total</span>
              <span>{formatRupiah(summary.total)}</span>
            </div>
          </div>

          <div>
            <div className="text-sm font-bold text-gray-900">Metode pembayaran</div>
            <div className="mt-2 space-y-2">
              {staticQrisAvailable && (
                <PaymentOption
                  active={paymentMethod === "static_qris"}
                  icon={ScanLine}
                  title="Static QRIS"
                  description="Scan QRIS venue, bayar sesuai total, lalu unggah bukti bayar."
                  onClick={() => onPaymentMethod("static_qris")}
                />
              )}
              {/* QRIS dinamis (Xendit) disembunyikan bila belum siap tapi Static QRIS ada. */}
              {(qrisAvailable || !staticQrisAvailable) && (
              <PaymentOption
                active={paymentMethod === "qris"}
                disabled={!qrisAvailable}
                icon={QrCode}
                title="QRIS"
                description={
                  qrisAvailable
                    ? "Bayar sekarang dari HP — pesanan langsung diproses."
                    : "Belum tersedia di venue ini."
                }
                onClick={() => onPaymentMethod("qris")}
              />
              )}
              {arkEnabled && (
              <PaymentOption
                active={paymentMethod === "ark_coin"}
                disabled={Boolean(member) && !arkEnough}
                icon={Coins}
                title="ARK Coin"
                description={
                  !member
                    ? "Masuk sebagai member untuk memakai saldo."
                    : arkEnough
                      ? `Saldo ${idrToArkDisplay(member.ark_coin_balance, member.ark_rate)} — langsung lunas.`
                      : `Saldo ${idrToArkDisplay(member.ark_coin_balance, member.ark_rate)} tidak cukup.`
                }
                onClick={() => (member ? onPaymentMethod("ark_coin") : onOpenMember())}
              />
              )}
              <PaymentOption
                active={paymentMethod === "cashier"}
                icon={WalletCards}
                title="Bayar di kasir"
                description="Pesanan masuk sebagai open bill, bayar saat selesai."
                onClick={() => onPaymentMethod("cashier")}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function PaymentOption({
  active,
  disabled,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof QrCode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-50 ${
        active ? "border-primary bg-primary/5" : "border-gray-200 bg-white"
      }`}
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          active ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
        }`}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </button>
  );
}
