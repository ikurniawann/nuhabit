"use client";

import { ReceiptText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatNumber, formatRp } from "@/lib/member-app/loyalty";
import { idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";
import { BottomSheet } from "../components/bottom-sheet";
import { useT } from "../lib/i18n";
import {
  useLoyaltyMe,
  useOrderDetail,
  useOutletVisits,
  useTransactions,
  type OrderSummary,
} from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDayTime, formatDay } from "../ui";
import { Notice, PageTitle, SectionHeader } from "./loyalty-ui";

/** Riwayat order POS (struk per order) dan ringkasan kunjungan per outlet. */
export function OrdersPage() {
  const t = useT();
  const { data, isLoading, error } = useTransactions();
  const { data: me } = useLoyaltyMe();
  const { data: visits } = useOutletVisits();
  const [open, setOpen] = useState<OrderSummary | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Every paid order at our outlets. Tap one for the receipt.")}>{t("Orders")}</PageTitle>
      {isLoading ? <Spinner label={t("Loading orders…")} /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {data && data.orders.length === 0 ? (
        <EmptyState title={t("No orders yet")} hint={t("Your first visit will show up here.")} />
      ) : null}
      {data && data.orders.length > 0 ? (
        <div className="nh-card divide-y divide-nh-line !py-0">
          {data.orders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setOpen(order)}
              className="flex w-full items-center gap-3 py-3.5 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nh-ink-soft text-white">
                <ReceiptText size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold">{order.orderNumber}</span>
                <span className="block text-xs text-nh-muted">{formatDayTime(order.createdAt)}</span>
              </span>
              <span className="shrink-0 text-right text-sm font-bold tabular-nums">
                {formatRp(order.totalIdr)}
                {order.paidWithArk && me ? (
                  <span className="block text-[11px] font-semibold text-nh-muted">
                    {formatNumber(idrToArkDisplay(order.totalIdr, me.arkRate))} ARK
                  </span>
                ) : null}
              </span>
            </button>
          ))}
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

/** Struk order: item, diskon, total, dan XP. Order ARK tampil "Rp X / N ARK" seperti struk kasir. */
function OrderSheet({ order, onClose }: { order: OrderSummary; onClose: () => void }) {
  const t = useT();
  const { data: detail, isLoading, error } = useOrderDetail(order.id);
  const paidWithArk = detail ? isArkCoinMethod(detail.order.payment_method) : false;
  const price = (idr: number) =>
    detail && paidWithArk
      ? `${formatRp(idr)} / ${formatNumber(idrToArkDisplay(idr, detail.ark_rate))} ARK`
      : formatRp(idr);

  return (
    <BottomSheet kicker={t("Receipt")} title={order.orderNumber} onClose={onClose}>
      {isLoading ? <Spinner /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {detail ? (
        <>
          <p className="mb-3 text-sm text-nh-muted">
            {formatDayTime(detail.order.ordered_at)}
            {detail.order.venue_name ? ` · ${detail.order.venue_name}` : ""}
          </p>
          <div className="nh-card divide-y divide-nh-line !py-1">
            {detail.items.map((item, i) => (
              <Row
                key={i}
                label={`${formatNumber(item.quantity)}× ${item.product_name}`}
                hint={`@ ${formatRp(item.unit_price)}${
                  item.discount_amount > 0
                    ? ` · ${t("discount {amount}", { amount: formatRp(item.discount_amount) })}`
                    : ""
                }`}
                value={price(item.total_amount)}
              />
            ))}
            <Row label={t("Subtotal")} value={price(detail.order.subtotal)} />
            {detail.order.discount_amount > 0 ? (
              <Row
                label={`${t("Discount")}${detail.order.discount_reason ? ` (${detail.order.discount_reason})` : ""}`}
                value={`−${formatRp(detail.order.discount_amount)}`}
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
        </>
      ) : null}
    </BottomSheet>
  );
}
