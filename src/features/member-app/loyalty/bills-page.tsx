"use client";

import { formatNumber, formatRp } from "@/lib/member-app/loyalty";
import { useT } from "../lib/i18n";
import { useMemberBill } from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDayTime } from "../ui";
import { Notice, PageTitle, SectionHeader } from "./loyalty-ui";

/** Tagihan Member: order yang belum lunas, sisa tagihan, dan cicilan yang sudah masuk. Bayar di kasir. */
export function BillsPage() {
  const t = useT();
  const { data: bill, isLoading, error } = useMemberBill();

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Orders on your member tab. Pay or pay in parts at any cashier.")}>
        {t("Member bill")}
      </PageTitle>
      {isLoading ? <Spinner label={t("Loading bill…")} /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}

      {bill ? (
        <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
          <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
          <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Left to pay")}</p>
          <p className="nh-display relative mt-1 text-5xl leading-none tabular-nums">
            {formatRp(bill.balance.outstanding)}
          </p>
          <div className="relative mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="nh-chip bg-white/10 text-white/80">
              {t("Open orders {amount}", { amount: formatRp(bill.balance.openTotal) })}
            </span>
            {bill.balance.credit > 0 ? (
              <span className="nh-chip bg-nh-lime text-nh-ink">
                {t("Paid so far {amount}", { amount: formatRp(bill.balance.credit) })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {bill && bill.open_orders.length === 0 ? (
        <EmptyState title={t("No open bill")} hint={t("Orders you put on your tab will show up here.")} />
      ) : null}

      {bill && bill.open_orders.length > 0 ? (
        <section>
          <SectionHeader label={t("Unpaid orders")} />
          <div className="flex flex-col gap-3">
            {bill.open_orders.map((order) => (
              <div key={order.id} className="nh-card">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-extrabold">{order.order_number ?? "-"}</p>
                  <p className="nh-display shrink-0 text-lg tabular-nums">{formatRp(order.total_amount)}</p>
                </div>
                <p className="text-xs text-nh-muted">{formatDayTime(order.ordered_at)}</p>
                {order.items.length > 0 ? (
                  <div className="mt-3 divide-y divide-nh-line border-t border-nh-line text-sm">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {formatNumber(item.quantity)}× {item.name}
                          </span>
                          {item.options.length > 0 ? (
                            <span className="block truncate text-xs text-nh-muted">{item.options.join(", ")}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-bold tabular-nums">{formatRp(item.total_amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {bill && bill.payments.length > 0 ? (
        <section>
          <SectionHeader label={t("Payments")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {bill.payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{payment.method}</span>
                  <span className="block text-xs text-nh-muted">{formatDayTime(payment.created_at)}</span>
                </span>
                <span className="nh-display shrink-0 text-lg text-nh-ok tabular-nums">+{formatRp(payment.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
