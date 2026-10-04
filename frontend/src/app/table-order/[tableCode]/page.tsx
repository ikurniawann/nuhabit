"use client";

import { useParams } from "next/navigation";
import { TableOrderApp } from "@/features/table-order/components/table-order-app";

/**
 * /table-order/[tableCode] — self-order dari QR meja (publik).
 * Kode = `pos_tables.qr_code` (atau nomor meja) yang di-encode ke QR di
 * Dashboard → POS → Tables → tombol QR. Logika ada di features/table-order.
 */
export default function TableOrderPage() {
  const params = useParams<{ tableCode: string }>();
  const tableCode = decodeURIComponent(params.tableCode || "").trim().toUpperCase() || "T-01";
  return <TableOrderApp key={tableCode} tableCode={tableCode} />;
}
