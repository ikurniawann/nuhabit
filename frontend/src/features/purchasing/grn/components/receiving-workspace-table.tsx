import type { ReactNode } from "react";
import Link from "next/link";
import { ClipboardCheck, Eye, PackageCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  RECEIVING_STATUS_LABELS,
  RECEIVING_STATUS_STYLES,
  canReshipForRemaining,
  canRunQualityControl,
  deliveryLabel,
  isFullyReceived,
  type ReceivingRow,
} from "@/lib/purchasing/receiving-ui-workspace";

const qty = (value: number) => formatNumber(value, 4);

type Routes = {
  poDetail: (id: string) => string;
  grnDetail: (id: string) => string;
  grnQc: (id: string) => string;
  grnInsert: string;
  deliveryInsert: string;
  deliveryDetail: (id: string) => string;
  /** Link "Lihat pengiriman" ketika baris belum punya aksi lain. */
  deliveryFallback: (id: string) => string;
};

export function receivingRoutes(isProduct: boolean): Routes {
  return isProduct
    ? {
        poDetail: PRODUCT_ROUTES.purchasingPoDetail,
        grnDetail: PRODUCT_ROUTES.purchasingReceiveDetail,
        grnQc: PRODUCT_ROUTES.purchasingReceiveQc,
        grnInsert: PRODUCT_ROUTES.purchasingReceiveInsert,
        deliveryInsert: PRODUCT_ROUTES.purchasingDeliveryInsert,
        deliveryDetail: PRODUCT_ROUTES.purchasingDeliveryDetail,
        deliveryFallback: PRODUCT_ROUTES.purchasingDeliveryDetail,
      }
    : {
        poDetail: (id) => `/dashboard/purchasing/po/${id}`,
        grnDetail: RM_ROUTES.purchasingGrnDetail,
        grnQc: RM_ROUTES.purchasingGrnQc,
        grnInsert: RM_ROUTES.purchasingGrnInsert,
        deliveryInsert: `${RM_ROUTES.purchasingDelivery}/insert`,
        deliveryDetail: (id) => `/dashboard/raw-material/purchasing/delivery/${id}`,
        deliveryFallback: (id) => `/dashboard/purchasing/delivery/${id}`,
      };
}

function IconLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <Link href={href}>
      <Button variant="ghost" size="sm" className="cursor-pointer" title={title}>
        {children}
      </Button>
    </Link>
  );
}

function RowActions({ row, routes }: { row: ReceivingRow; routes: Routes }) {
  // GRN baru hanya untuk pengiriman yang belum punya GRN.
  const receiveId = !isFullyReceived(row) ? row.pendingDelivery?.id : undefined;
  const reship = canReshipForRemaining(row);
  const qc = canRunQualityControl(row);
  const hasPrimary = Boolean(receiveId || reship || row.grnId);

  return (
    <div className="flex items-center justify-end gap-1">
      {receiveId && (
        <IconLink href={`${routes.grnInsert}?delivery_id=${receiveId}`} title="Buat GRN">
          <PackageCheck className="h-4 w-4 text-brand-text" />
        </IconLink>
      )}
      {reship && (
        <Link href={`${routes.deliveryInsert}?po_id=${row.poId}`}>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg border-primary/20 px-2.5 text-xs font-medium text-brand-text shadow-sm hover:!border-primary/30 hover:!bg-primary/5 hover:!text-brand-text"
            title="Buat pengiriman baru untuk sisa qty"
          >
            <Truck className="h-3.5 w-3.5" />
            Kirim Ulang
          </Button>
        </Link>
      )}
      {row.grnId && (
        <IconLink href={routes.grnDetail(row.grnId)} title="Lihat detail">
          <Eye className="h-4 w-4 text-pink-600" />
        </IconLink>
      )}
      {qc && row.grnId ? (
        <IconLink href={routes.grnQc(row.grnId)} title="Inspeksi QC">
          <ClipboardCheck className="h-4 w-4 text-emerald-600" />
        </IconLink>
      ) : !hasPrimary && row.deliveryId ? (
        <IconLink href={routes.deliveryFallback(row.deliveryId)} title="Lihat pengiriman">
          <Eye className="h-4 w-4 text-pink-600" />
        </IconLink>
      ) : !hasPrimary && row.poId ? (
        <IconLink href={routes.poDetail(row.poId)} title="Lihat purchase order">
          <Eye className="h-4 w-4 text-pink-600" />
        </IconLink>
      ) : null}
    </div>
  );
}

export function ReceivingWorkspaceTable({
  rows,
  isProduct,
}: {
  rows: ReceivingRow[];
  isProduct: boolean;
}) {
  const routes = receivingRoutes(isProduct);
  const headings = [
    "Purchase Order",
    isProduct ? "Vendor" : "Supplier",
    "No. GRN",
    "Pengiriman",
    "Progress Item",
    "Status",
    "Terakhir Diubah",
    "Aksi",
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {headings.map((heading) => (
              <th key={heading} className={`px-4 py-3 font-semibold ${heading === "Aksi" ? "text-right" : "text-left"}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                {row.poId ? (
                  <Link href={routes.poDetail(row.poId)} className="font-medium text-pink-700 hover:underline">
                    {row.poNumber}
                  </Link>
                ) : (
                  <span className="font-medium">{row.poNumber}</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm">{row.supplierName}</td>
              <td className="px-4 py-3 text-sm">
                {row.grns.length === 0 ? (
                  <span className="text-gray-400">-</span>
                ) : (
                  <div className="space-y-1">
                    {row.grns.slice(0, 3).map((grn) => (
                      <Link
                        key={grn.id}
                        href={routes.grnDetail(grn.id)}
                        className="block font-medium text-pink-700 hover:underline"
                      >
                        {grn.nomor_grn}
                      </Link>
                    ))}
                    {row.grns.length > 3 && <div className="text-xs text-gray-500">+{row.grns.length - 3} lainnya</div>}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="space-y-1.5">
                  {row.deliveries.slice(0, 3).map((delivery) => (
                    <div key={delivery.id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={routes.deliveryDetail(delivery.id)}
                          className="font-medium text-gray-900 hover:text-pink-700 hover:underline"
                        >
                          {deliveryLabel(delivery)}
                        </Link>
                        <span className="text-xs text-gray-400">Surat Jalan: {delivery.no_surat_jalan || "-"}</span>
                      </div>
                      {!row.grns.some((grn) => grn.delivery_id === delivery.id) && (
                        <div className="mt-1 text-xs text-amber-600">GRN belum dicatat</div>
                      )}
                    </div>
                  ))}
                  {row.deliveries.length > 3 && (
                    <div className="text-xs text-gray-500">+{row.deliveries.length - 3} pengiriman lainnya</div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="font-medium">
                  Diterima {qty(row.receivedQty)} / {qty(row.orderedQty)}
                </div>
                {row.remainingQty > 0 && <div className="text-xs text-gray-500">Sisa {qty(row.remainingQty)}</div>}
                {/* Kekurangan hanya ditampilkan bila PO ditutup; sisa yang dikirim ulang tidak dihitung tolak. */}
                {row.poStatus === "closed" && row.remainingQty > 0 && (
                  <div className="text-xs text-red-600">{qty(row.remainingQty)} tidak dipenuhi (PO ditutup)</div>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge variant="outline" className={RECEIVING_STATUS_STYLES[row.status]}>
                  {RECEIVING_STATUS_LABELS[row.status]}
                </Badge>
              </td>
              <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
              <td className="px-4 py-3 text-right">
                <RowActions row={row} routes={routes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
