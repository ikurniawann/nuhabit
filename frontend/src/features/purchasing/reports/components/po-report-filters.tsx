"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { PO_STATUS_OPTIONS } from "@/lib/purchasing/report-ui-po";
import { useSupplierFilterOptions } from "../queries";
import type { POSummaryParams } from "../types";
import { DateFilterField, ReportFilterField } from "./report-ui";

/** State filter laporan PO (periode, status, supplier) dan parameter API turunannya. */
export function usePoReportFilters() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("all");
  const [vendorId, setVendorId] = useState("all");
  const params: POSummaryParams = {
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    status: status === "all" ? undefined : status,
    vendor_id: vendorId === "all" ? undefined : vendorId,
  };
  return { dateFrom, setDateFrom, dateTo, setDateTo, status, setStatus, vendorId, setVendorId, params };
}

export function PoReportFilters({ filters }: { filters: ReturnType<typeof usePoReportFilters> }) {
  const supplierOptions = useSupplierFilterOptions();
  return (
    <Card className="border-border shadow-xs">
      <CardContent className="pt-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DateFilterField label="Dari Tanggal" value={filters.dateFrom} onChange={filters.setDateFrom} />
          <DateFilterField label="Sampai Tanggal" value={filters.dateTo} onChange={filters.setDateTo} />
          <ReportFilterField label="Status">
            <Combobox
              options={PO_STATUS_OPTIONS}
              value={filters.status}
              onChange={filters.setStatus}
              placeholder="Semua Status"
              searchPlaceholder="Cari status..."
              emptyMessage="Status tidak ditemukan"
              className="h-10"
            />
          </ReportFilterField>
          <ReportFilterField label="Supplier">
            <Combobox
              options={supplierOptions}
              value={filters.vendorId}
              onChange={filters.setVendorId}
              placeholder="Semua Supplier"
              searchPlaceholder="Cari supplier..."
              emptyMessage="Supplier tidak ditemukan"
              className="h-10"
            />
          </ReportFilterField>
        </div>
      </CardContent>
    </Card>
  );
}
