"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CsvImporter } from "@/components/ui/csv-importer";
import { useQueryClient } from "@tanstack/react-query";
import { leadQueryKeys } from "../queries";
import { LEAD_IMPORT_COLUMNS, LEAD_IMPORT_SAMPLE_ROWS } from "@/lib/sales-funnel/lead-import-config";

interface LeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadImportDialog({ open, onOpenChange }: LeadImportDialogProps) {
  const queryClient = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Leads dari CSV</DialogTitle>
        </DialogHeader>
        <CsvImporter
          embedded
          hideHeader
          title="Import Leads"
          description="Upload CSV berisi daftar prospek. Baris dengan no. WA yang sudah terdaftar akan dilewati."
          templateName="template-leads"
          apiEndpoint="/api/sales-funnel/leads/import"
          columns={LEAD_IMPORT_COLUMNS}
          sampleRows={LEAD_IMPORT_SAMPLE_ROWS}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
