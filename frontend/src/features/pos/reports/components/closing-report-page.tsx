"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageTransition } from "@/components/motion";
import { HelpHint } from "@/components/ui/help-hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useClosingReport } from "../queries";
import { todayWib } from "@/lib/pos/report-dates";
import { formatNumber, formatRupiah } from "@/lib/format";

const formatVariance = (value: number) => {
  const formatted = formatRupiah(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
};

const formatQty = (value: number) => (value > 0 ? formatNumber(value) : "-");

function line(label: string, value: string, className = "") {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <span className="shrink-0">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

type ShiftOption = {
  id: string;
  shift_number: string;
  status?: string | null;
};

export function ClosingReportPage() {
  const [date, setDate] = useState(todayWib);
  const [shiftId, setShiftId] = useState("");
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);

  const { data: report, isLoading, isFetching, error } = useClosingReport({
    date,
    shift_id: shiftId || undefined,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadShifts() {
      setLoadingShifts(true);
      try {
        const response = await fetch(`/api/pos/shifts?date=${date}&limit=100`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && payload.success) {
          setShifts((payload.data || []) as ShiftOption[]);
        }
      } catch {
        if (!cancelled) setShifts([]);
      } finally {
        if (!cancelled) setLoadingShifts(false);
      }
    }
    void loadShifts();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const loading = isLoading || isFetching;
  const errorMessage = error instanceof Error ? error.message : "";

  const shiftOptions = useMemo(
    () => [
      { value: "all", label: "All shifts" },
      ...shifts.map((shift) => ({
        value: shift.id,
        label: `${shift.shift_number}${shift.status ? ` (${shift.status})` : ""}`,
      })),
    ],
    [shifts]
  );

  return (
    <TooltipProvider>
      <PageTransition>
        <div className="space-y-6">
          <div className="print:hidden">
            <PurchasingPageHeader
              title="Cashier Closing Report"
              description="Daily sales summary, category breakdown, targets, and promo usage"
              actions={
                <div className="flex w-full flex-col gap-3 rounded-lg border border-gray-200/70 bg-white p-3 sm:flex-row sm:items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Date</Label>
                    <Input
                      type="date"
                      value={date}
                      onChange={(event) => {
                        setDate(event.target.value);
                        setShiftId("");
                      }}
                      className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Shift</Label>
                    <Combobox
                      options={shiftOptions}
                      value={shiftId || "all"}
                      onChange={(value) => setShiftId(value === "all" ? "" : value)}
                      placeholder={loadingShifts ? "Loading shifts..." : "All shifts"}
                      searchPlaceholder="Search shift..."
                      emptyMessage="No shift found"
                      disabled={loadingShifts}
                      className="h-9 w-full! min-w-[200px] text-sm sm:w-52"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="purchasing-secondary-button h-9 w-full sm:w-auto"
                    onClick={() => window.print()}
                    disabled={!report}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                </div>
              }
            />
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm text-red-700 print:hidden">
              <AlertCircle className="h-4 w-4" />
              {errorMessage}
            </div>
          )}

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-20 text-gray-500 print:hidden">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading closing report...</span>
            </div>
          ) : report ? (
            <Card className="border-gray-200/70 shadow-xs print:border-0 print:shadow-none">
              <CardContent className="p-6 sm:p-8">
                <div className="closing-report mx-auto max-w-3xl font-mono text-[13px] leading-6 text-gray-800 sm:text-sm">
                  <div className="text-center">
                    <p className="text-base font-semibold text-gray-900 sm:text-lg">{report.header.title}</p>
                    <p className="mt-1 font-medium">{report.header.outlet_line}</p>
                    <p className="mt-1">{report.header.report_date}</p>
                  </div>

                  <div className="my-5 space-y-1">
                    {report.shift_sessions.map((session) => (
                      <p key={`${session.label}-${session.last_order}`}>
                        Last order : {session.last_order} - Closed : {session.closed_at} ({session.label})
                      </p>
                    ))}
                  </div>

                  <div className="my-4 border-t border-gray-300" />

                  <p className="font-semibold text-gray-900">TRANSAKSI</p>
                  <div className="mt-2 space-y-1">
                    {line(
                      `${report.transaction_totals?.transactions ?? 0} transaksi`,
                      formatRupiah(report.transaction_totals?.sales ?? 0)
                    )}
                    {line("Diskon", formatRupiah(report.transaction_totals?.discount ?? 0))}
                  </div>

                  <div className="mt-4">
                    <p className="font-semibold text-gray-900">DISKON 100%</p>
                    <div className="mt-2 space-y-1">
                      {line(
                        `${report.transaction_totals?.full_discount_transactions ?? 0} transaksi`,
                        formatRupiah(report.transaction_totals?.full_discount_amount ?? 0)
                      )}
                    </div>
                  </div>

                  <div className="my-4 border-t border-gray-300" />

                  <p className="font-semibold text-gray-900">SALES SUMMARY</p>
                  <div className="mt-2 space-y-1">
                    {/* Nett Sales with HelpHint (print:hidden on hint) */}
                    <div className="flex items-start justify-between gap-4">
                      <span className="flex shrink-0 items-center gap-1">
                        Nett Sales
                        <HelpHint
                          helpId="report.closing.net-sales"
                          role="kepala_cabang"
                          className="print:hidden"
                        />
                      </span>
                      <span className="text-right font-medium text-gray-900">
                        {formatRupiah(report.sales_summary.net_sales)}
                      </span>
                    </div>
                    {line("Service", formatRupiah(report.sales_summary.service))}
                    {line("Tax", formatRupiah(report.sales_summary.tax))}
                    {line("Discount", formatRupiah(report.sales_summary.discount))}
                    {line("Gross", formatRupiah(report.sales_summary.gross), "font-semibold")}
                  </div>

                  <div className="mt-4 space-y-1">
                    {line("No of Guest", `${report.guests.count} pax`)}
                    {line("Average/Pax", formatRupiah(report.guests.average_per_pax))}
                  </div>

                  {report.categories_by_segment.map((section) => (
                    <div key={section.segment} className="mt-6">
                      <p className="font-semibold text-gray-900">{section.title}</p>
                      <div className="mt-2 space-y-1">
                        {section.rows.map((row) => (
                          <div key={`${section.segment}-${row.name}`} className="flex justify-between gap-4">
                            <span className="truncate">
                              {row.name}
                              <span className="text-gray-500">
                                {" "}
                                : {formatRupiah(row.amount)}
                              </span>
                            </span>
                            <span className="shrink-0 text-gray-600">({row.percentage}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="mt-6 space-y-4">
                    <div>
                      <p className="flex items-center gap-1 font-semibold text-gray-900">
                        DAILY
                        <HelpHint
                          helpId="report.closing.target-daily"
                          role="kepala_cabang"
                          className="print:hidden"
                        />
                      </p>
                      <div className="mt-2 space-y-1">
                        {line("Target", formatRupiah(report.targets.daily.target))}
                        {line("Actual", formatRupiah(report.targets.daily.actual))}
                        {line("Variance", formatVariance(report.targets.daily.variance))}
                      </div>
                    </div>
                    <div>
                      <p className="flex items-center gap-1 font-semibold text-gray-900">
                        MONTHLY
                        <HelpHint
                          helpId="report.closing.target-monthly"
                          role="kepala_cabang"
                          className="print:hidden"
                        />
                      </p>
                      <div className="mt-2 space-y-1">
                        {line("Target", formatRupiah(report.targets.monthly.target))}
                        {line("Actual", formatRupiah(report.targets.monthly.actual))}
                        {line("Variance", formatVariance(report.targets.monthly.variance))}
                      </div>
                    </div>
                    <div>
                      <p className="flex items-center gap-1 font-semibold text-gray-900">
                        MONTH TO DATE
                        <HelpHint
                          helpId="report.closing.target-mtd"
                          role="kepala_cabang"
                          className="print:hidden"
                        />
                      </p>
                      <div className="mt-2 space-y-1">
                        {line("Target", formatRupiah(report.targets.month_to_date.target))}
                        {line("Actual", formatRupiah(report.targets.month_to_date.actual))}
                        {line("Variance", formatVariance(report.targets.month_to_date.variance))}
                      </div>
                    </div>
                  </div>

                  {report.promos_by_segment.map((section) => (
                    <div key={section.segment} className="mt-6">
                      <p className="font-semibold text-gray-900">{section.title}</p>
                      <div className="mt-2 space-y-1">
                        {section.rows.length > 0 ? (
                          section.rows.map((row) => (
                            <div key={`${section.segment}-${row.name}`} className="flex justify-between gap-4">
                              <span className="truncate">{row.name}</span>
                              <span className="shrink-0">{formatQty(row.qty)}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-gray-500">-</p>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="mt-8 border-t border-gray-300 pt-4">
                    <p>Regards</p>
                    <p className="mt-2 font-medium text-gray-900">{report.footer.printed_by}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <style>{`
            @media print {
              aside, [data-sidebar], header, nav { display: none !important; }
              body { background: white !important; }
              .closing-report { max-width: none; font-size: 12px; }
            }
          `}</style>
        </div>
      </PageTransition>
    </TooltipProvider>
  );
}
