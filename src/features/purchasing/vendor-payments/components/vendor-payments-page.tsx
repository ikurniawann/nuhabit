"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileText,
  Filter,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { RM_ROUTES, PRODUCT_ROUTES, GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { usePurchaseInvoiceList } from "../queries";
import type { PurchaseInvoicePaymentStatus, PurchaseInvoiceRow } from "../types";
import { formatDate, formatNumber } from "@/lib/format";

const AP_PAYMENTS_HREF = "/dashboard/accounting/accounts-payable/payments";

const PAYMENT_STATUS_LABELS: Record<PurchaseInvoicePaymentStatus, string> = {
  unpaid: "Belum Dibayar",
  partial: "Dibayar Sebagian",
  paid: "Lunas",
  overdue: "Lewat Jatuh Tempo",
};

const PAYMENT_STATUS_STYLES: Record<PurchaseInvoicePaymentStatus, string> = {
  unpaid: "border-gray-200 bg-gray-50 text-gray-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status Pembayaran" },
  { value: "unpaid", label: "Belum Dibayar" },
  { value: "partial", label: "Dibayar Sebagian" },
  { value: "paid", label: "Lunas" },
  { value: "overdue", label: "Lewat Jatuh Tempo" },
];

export function PurchaseInvoicesPage({
  moduleType = "raw_material",
  title = "Invoice Pembelian",
  listTitle = "Daftar Invoice & Tagihan",
}: {
  moduleType?: "raw_material" | "product" | "general";
  title?: string;
  listTitle?: string;
}) {
  const routes =
    moduleType === "general"
      ? GENERAL_ROUTES
      : moduleType === "product"
        ? PRODUCT_ROUTES
        : RM_ROUTES;
  // Product & general REUSE tabel vendors → label "Vendor"; raw_material = "Supplier".
  const partyLabel = moduleType === "raw_material" ? "Supplier" : "Vendor";
  const router = useRouter();
  const [page, setPage] = useState(1);
  const limit = 10;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseInvoicePaymentStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const listQuery = usePurchaseInvoiceList(
    {
      search: search || undefined,
      status: statusFilter,
    },
    moduleType
  );
  const allRows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isLoading;

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(
        listQuery.error instanceof Error
          ? listQuery.error.message
          : "Gagal memuat invoice pembelian"
      );
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const summary = useMemo(
    () =>
      allRows.reduce(
        (acc, row) => {
          acc.payable += Number(row.payable_amount || 0);
          acc.paid += Number(row.paid_amount || 0);
          acc.outstanding += Number(row.outstanding_amount || 0);
          if (row.payment_status === "overdue") acc.overdue += 1;
          return acc;
        },
        { payable: 0, paid: 0, outstanding: 0, overdue: 0 }
      ),
    [allRows]
  );

  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rows = allRows.slice((page - 1) * limit, page * limit);

  const isFilterActive = statusFilter !== "all";
  const handleResetFilters = () => {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={title}
        description={
          <>
            Pantau tagihan supplier, termin pembayaran, jatuh tempo, dan progres pelunasan — {total}{" "}
            purchase order
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <WalletCards className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Total Tagihan</p>
                <p className="text-lg font-bold text-gray-900">{formatNumber(summary.payable)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Nominal Dibayar</p>
                <p className="text-lg font-bold text-emerald-700">{formatNumber(summary.paid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Sisa Tagihan</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(summary.outstanding)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">PO Lewat Jatuh Tempo</p>
                <p className="text-lg font-bold text-red-600">{summary.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={FileText}
        title={listTitle}
        description="Pantau tagihan purchase order, nota kredit retur yang disetujui, jatuh tempo, dan status pelunasan."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={`Cari nomor PO atau ${partyLabel.toLowerCase()}...`}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  1
                </span>
              )}
            </Button>
            {(search || isFilterActive || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 flex-shrink-0 rounded-lg"
              >
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        {filterOpen && (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2 lg:max-w-md">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <Filter className="h-3.5 w-3.5 text-pink-500" />
                  Status Pembayaran
                </div>
                <Combobox
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as PurchaseInvoicePaymentStatus | "all");
                    setPage(1);
                  }}
                  placeholder="Semua status pembayaran"
                  searchPlaceholder="Cari status..."
                  emptyMessage="Status tidak ditemukan"
                  className="w-full! h-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <div className="px-4">
          {loading ? (
            <div className="py-14 text-center text-sm text-gray-500">Memuat invoice pembelian...</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-center">
              <Banknote className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-600">Invoice pembelian tidak ditemukan</p>
              <p className="mt-1 max-w-md text-xs text-gray-500">
                Purchase order yang sudah disetujui atau dikirim dan memiliki nominal tagihan akan
                muncul di sini setelah termin pembayaran dijadwalkan di PO.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Nomor PO</th>
                      <th className="px-4 py-3 text-left font-semibold">Tanggal PO</th>
                      <th className="px-4 py-3 text-left font-semibold">{partyLabel}</th>
                      <th className="px-4 py-3 text-right font-semibold">Total PO</th>
                      <th className="px-4 py-3 text-right font-semibold">Retur</th>
                      <th className="px-4 py-3 text-right font-semibold">Nota Kredit Reject</th>
                      <th className="px-4 py-3 text-right font-semibold">Tagihan Bersih</th>
                      <th className="px-4 py-3 text-right font-semibold">Nominal Dibayar</th>
                      <th className="px-4 py-3 text-right font-semibold">Sisa Tagihan</th>
                      <th className="px-4 py-3 text-center font-semibold">Termin</th>
                      <th className="px-4 py-3 text-center font-semibold">Penerimaan</th>
                      <th className="px-4 py-3 text-center font-semibold">Pembayaran</th>
                      <th className="px-4 py-3 text-left font-semibold">Jatuh Tempo Berikutnya</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row) => (
                      <InvoiceTableRow
                        key={row.purchase_order_id}
                        row={row}
                        poDetailRoute={routes.purchasingInvoicePoDetail(row.purchase_order_id)}
                        onOpen={() =>
                          router.push(routes.purchasingInvoicePoDetail(row.purchase_order_id))
                        }
                        onPay={() => router.push(AP_PAYMENTS_HREF)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}

function InvoiceTableRow({
  row,
  poDetailRoute,
  onOpen,
  onPay,
}: {
  row: PurchaseInvoiceRow;
  poDetailRoute: string;
  onOpen: () => void;
  onPay: () => void;
}) {
  const status = row.payment_status as PurchaseInvoicePaymentStatus;

  return (
    <tr className="cursor-pointer hover:bg-gray-50/80" onClick={onOpen}>
      <td className="px-4 py-3">
        <Link
          href={poDetailRoute}
          className="font-medium text-pink-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.nomor_po}
        </Link>
      </td>
      <td className="px-4 py-3 text-gray-600">{formatDate(row.tanggal_po)}</td>
      <td className="px-4 py-3 text-gray-700">{row.nama_supplier || "-"}</td>
      <td className="px-4 py-3 text-right font-medium text-gray-900">
        {formatNumber(row.gross_payable_amount)}
      </td>
      <td className="px-4 py-3 text-right text-red-600">
        {row.return_credit_amount > 0 ? `-${formatNumber(row.return_credit_amount)}` : "-"}
      </td>
      <td className="px-4 py-3 text-right text-red-600">
        {row.reject_credit_amount > 0 ? `-${formatNumber(row.reject_credit_amount)}` : "-"}
      </td>
      <td className="px-4 py-3 text-right font-medium text-gray-900">
        {formatNumber(row.payable_amount)}
      </td>
      <td className="px-4 py-3 text-right text-emerald-700">{formatNumber(row.paid_amount)}</td>
      <td className="px-4 py-3 text-right font-semibold text-gray-900">
        {formatNumber(row.outstanding_amount)}
      </td>
      <td className="px-4 py-3 text-center text-gray-600">{row.payment_term_count || 0}</td>
      <td className="px-4 py-3 text-center text-gray-600">
        {`${formatNumber(Number(row.received_percentage || 0), 1)}%`}
      </td>
      <td className="px-4 py-3 text-center font-medium text-pink-700">
        {`${formatNumber(Number(row.payment_progress_pct || 0), 1)}%`}
      </td>
      <td className="px-4 py-3 text-gray-700">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-gray-400" />
          {row.next_due_date ? formatDate(row.next_due_date) : "-"}
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <Badge variant="outline" className={PAYMENT_STATUS_STYLES[status]}>
          {PAYMENT_STATUS_LABELS[status] || status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {row.can_pay && (
            <Button
              variant="outline"
              size="sm"
              title="Bayar di Accounting AP Payment"
              className="h-8 rounded-lg border-primary/20 px-3 text-xs font-medium text-brand-text hover:bg-primary/5"
              onClick={onPay}
            >
              <Banknote className="mr-1.5 h-3.5 w-3.5" />
              Bayar di Accounting
            </Button>
          )}
          <Link href={poDetailRoute}>
            <Button variant="ghost" size="sm" title="Lihat detail invoice" className="cursor-pointer">
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </td>
    </tr>
  );
}

/** @deprecated Use PurchaseInvoicesPage */
export const VendorPaymentsPage = PurchaseInvoicesPage;
