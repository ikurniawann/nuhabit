"use client";

import { ReceiptText, ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatNumber, formatRupiah } from "@/lib/format";
import { idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";
import { BottomSheet } from "../components/bottom-sheet";
import { useT } from "../lib/i18n";
import {
  useLoyaltyMe,
  useOrderDetail,
  useOutletVisits,
  useTransactions,
  type OrderSummary,
  type ShopOrderDetail,
} from "../lib/queries-loyalty";
import { EmptyState, Spinner, StatusBadge, formatDayTime, formatDay, type Tone } from "../ui";
import { Notice, PageTitle, SectionHeader } from "./loyalty-ui";

type T = ReturnType<typeof useT>;

/** The label and tone of an online shop order status. */
function shopStatus(t: T, status: string): { label: string; tone: Tone } {
  switch (status) {
    case "pending":
      return { label: t("Awaiting payment"), tone: "warn" };
    case "paid":
      return { label: t("Paid"), tone: "ok" };
    case "packing":
      return { label: t("Packing"), tone: "info" };
    case "shipped":
      return { label: t("Shipped"), tone: "info" };
    case "completed":
      return { label: t("Delivered"), tone: "ok" };
    case "ready_for_pickup":
      return { label: t("Ready for pickup"), tone: "brand" };
    case "picked_up":
      return { label: t("Picked up"), tone: "ok" };
    case "cancelled":
      return { label: t("Cancelled"), tone: "danger" };
    case "refund":
      return { label: t("Refunded"), tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Riwayat order: struk outlet (POS) dan order toko online, plus kunjungan per outlet. */
export function OrdersPage() {
  const t = useT();
  const { data, isLoading, error } = useTransactions();
  const { data: me } = useLoyaltyMe();
  const { data: visits } = useOutletVisits();
  const [open, setOpen] = useState<OrderSummary | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Outlet receipts and online shop orders. Tap one for details.")}>{t("Orders")}</PageTitle>
      {isLoading ? <Spinner label={t("Loading orders…")} /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {data && data.orders.length === 0 ? (
        <EmptyState title={t("No orders yet")} hint={t("Your first visit will show up here.")} />
      ) : null}
      {data && data.orders.length > 0 ? (
        <div className="nh-card divide-y divide-nh-line !py-0">
          {data.orders.map((order) => {
            const shop = order.source === "shop";
            const status = shop ? shopStatus(t, order.status) : null;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => setOpen(order)}
                className="flex w-full items-center gap-3 py-3.5 text-left"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    shop ? "bg-nh-lime text-nh-forest" : "bg-nh-ink-soft text-white"
                  }`}
                >
                  {shop ? <ShoppingBag size={18} /> : <ReceiptText size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{order.orderNumber}</span>
                  <span className="block truncate text-xs text-nh-muted">
                    {shop ? t("Online shop") : t("Outlet")} · {formatDayTime(order.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-bold tabular-nums">
                  {formatRupiah(order.totalIdr)}
                  {status ? (
                    <span className="mt-0.5 block">
                      <StatusBadge status={status.label} tone={status.tone} />
                    </span>
                  ) : null}
                  {order.paidWithArk && me ? (
                    <span className="block text-[11px] font-semibold text-nh-muted">
                      {formatNumber(idrToArkDisplay(order.totalIdr, me.arkRate))} ARK
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {visits && visits.venues.length > 0 ? (
        <section>
          <SectionHeader label={t("Visits by outlet")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {visits.venues.map((venue) => (
              <div key={venue.venue_name} className="flex items-start justify-between gap-3 py-3 text-sm">
                <span className="font-semibold">
                  {venue.venue_name}
                  <span className="block text-xs font-medium text-nh-muted">
                    {t("{orders} orders · {days} days", {
                      orders: formatNumber(venue.order_count),
                      days: formatNumber(venue.day_count),
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-nh-muted">{formatDay(venue.last_visit_at)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {open ? <OrderSheet order={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Row({
  label,
  hint,
  value,
  tone,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: ReactNode;
  tone?: "total" | "ok" | "danger";
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 text-sm">
      <span className={tone === "total" ? "font-extrabold" : "font-semibold"}>
        {label}
        {hint ? <span className="block text-xs font-medium text-nh-muted">{hint}</span> : null}
      </span>
      <b className={`shrink-0 text-right ${tone === "ok" ? "text-nh-ok" : tone === "danger" ? "text-nh-danger" : ""}`}>
        {value}
      </b>
    </div>
  );
}

/** Struk order: item, diskon, total, dan XP; order toko online menambah status, pengiriman/pickup dan tautan bayar. */
function OrderSheet({ order, onClose }: { order: OrderSummary; onClose: () => void }) {
  const t = useT();
  const { data: detail, isLoading, error } = useOrderDetail(order.id);
  const shop = detail?.shop ?? null;
  const paidWithArk = detail ? isArkCoinMethod(detail.order.payment_method) : false;
  const price = (idr: number) =>
    detail && paidWithArk
      ? `${formatRupiah(idr)} / ${formatNumber(idrToArkDisplay(idr, detail.ark_rate))} ARK`
      : formatRupiah(idr);

  return (
    <BottomSheet kicker={order.source === "shop" ? t("Online shop order") : t("Receipt")} title={order.orderNumber} onClose={onClose}>
      {isLoading ? <Spinner /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {detail ? (
        <>
          <p className="mb-3 text-sm text-nh-muted">
            {formatDayTime(detail.order.ordered_at)}
            {detail.order.venue_name ? ` · ${detail.order.venue_name}` : ""}
          </p>
          {shop ? <ShopOrderSummary shop={shop} /> : null}
          <div className="nh-card divide-y divide-nh-line !py-1">
            {detail.items.map((item, i) => (
              <Row
                key={i}
                label={`${formatNumber(item.quantity)}× ${item.product_name}`}
                hint={`@ ${formatRupiah(item.unit_price)}${
                  item.discount_amount > 0
                    ? ` · ${t("discount {amount}", { amount: formatRupiah(item.discount_amount) })}`
                    : ""
                }`}
                value={price(item.total_amount)}
              />
            ))}
            <Row label={t("Subtotal")} value={price(detail.order.subtotal)} />
            {shop ? (
              <Row
                label={shop.delivery.method === "pickup" ? t("Pickup") : t("Shipping")}
                value={shop.delivery.method === "pickup" ? t("Free") : formatRupiah(shop.shipping_cost)}
              />
            ) : null}
            {detail.order.discount_amount > 0 ? (
              <Row
                label={`${t("Discount")}${detail.order.discount_reason ? ` (${detail.order.discount_reason})` : ""}`}
                value={`−${formatRupiah(detail.order.discount_amount)}`}
                tone="danger"
              />
            ) : null}
            <Row label={t("Total")} value={price(detail.order.total_amount)} tone="total" />
            {paidWithArk ? (
              <Row
                label={t("Paid with ARK")}
                value={`${formatNumber(
                  idrToArkDisplay(detail.order.ark_coins_used || detail.order.total_amount, detail.ark_rate),
                )} ARK`}
              />
            ) : null}
            {detail.xp_earned > 0 ? (
              <Row label={t("XP earned")} value={`+${formatNumber(detail.xp_earned)} XP`} tone="ok" />
            ) : null}
          </div>
          {shop ? (
            <div className="mt-4 flex flex-col gap-2">
              {shop.invoice_url ? (
                <a href={shop.invoice_url} className="nh-btn-brand w-full">
                  {t("Pay now")}
                </a>
              ) : null}
              <a href={shop.status_url} className="nh-btn-ghost w-full">
                {t("Track order")}
              </a>
            </div>
          ) : null}
        </>
      ) : null}
    </BottomSheet>
  );
}

/** Status dan tujuan order toko online: alamat + kurir, atau cabang pickup. */
function ShopOrderSummary({ shop }: { shop: ShopOrderDetail }) {
  const t = useT();
  const status = shopStatus(t, shop.status);
  const { delivery } = shop;
  return (
    <div className="nh-card mb-3 flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t("Status")}</span>
        <StatusBadge status={status.label} tone={status.tone} />
      </div>
      {delivery.method === "pickup" ? (
        <p>
          <span className="block font-semibold">{t("Pick up at {branch}", { branch: delivery.branch?.name ?? t("the store") })}</span>
          {delivery.branch?.address ? <span className="block text-xs text-nh-muted">{delivery.branch.address}</span> : null}
          {delivery.ready_at ? (
            <span className="block text-xs text-nh-muted">
              {t("Ready since {time}", { time: formatDayTime(delivery.ready_at) })}
            </span>
          ) : null}
        </p>
      ) : (
        <p>
          <span className="block font-semibold">{t("Ship to")}</span>
          <span className="block text-xs text-nh-muted">
            {delivery.address}
            {delivery.area_label ? `, ${delivery.area_label}` : ""}
          </span>
          {delivery.courier ? (
            <span className="block text-xs text-nh-muted">
              {delivery.courier}
              {delivery.eta_text ? ` · ${delivery.eta_text}` : ""}
              {delivery.waybill ? ` · ${t("Waybill {code}", { code: delivery.waybill })}` : ""}
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}
