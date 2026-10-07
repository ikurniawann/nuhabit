"use client";

import { FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReportExportActions({
  canExport,
  exporting,
  onPrint,
  onExportExcel,
}: {
  canExport: boolean;
  exporting: boolean;
  onPrint: () => void;
  onExportExcel: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row print:hidden">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full border-border sm:w-auto"
        onClick={onPrint}
        disabled={!canExport}
      >
        <Printer className="mr-2 h-4 w-4" />
        Print
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full border-border sm:w-auto"
        onClick={onExportExcel}
        disabled={!canExport || exporting}
      >
        {exporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="mr-2 h-4 w-4" />
        )}
        Excel
      </Button>
    </div>
  );
}

export function ReportPrintStyles() {
  return (
    <style>{`
      @media print {
        aside, [data-sidebar], header, nav { display: none !important; }
        body { background: white !important; }
        @page { size: A4 landscape; margin: 12mm; }
      }
    `}</style>
  );
}
