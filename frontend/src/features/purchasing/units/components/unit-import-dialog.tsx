"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CsvImporter } from "@/components/ui/csv-importer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UNIT_IMPORT_COLUMNS, UNIT_IMPORT_SAMPLE_ROWS } from "@/lib/purchasing/import-columns";
import { unitsQueryKeys } from "../query-keys";

interface UnitImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Tambah satuan massal dari CSV; kode yang sudah dipakai dilewati, bukan diperbarui. */
export function UnitImportDialog({ open, onOpenChange }: UnitImportDialogProps) {
  const queryClient = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Impor Satuan</DialogTitle>
          <DialogDescription>
            Unggah CSV berisi kode, nama, tipe, dan status satuan. Kode yang sudah ada dilewati.
          </DialogDescription>
        </DialogHeader>
        <CsvImporter
          embedded
          hideHeader
          csvOnly
          title="Impor Satuan"
          description="Unggah CSV untuk menambah satuan secara massal."
          templateName="template-satuan.csv"
          apiEndpoint="/api/purchasing/import/units"
          columns={UNIT_IMPORT_COLUMNS}
          sampleRows={UNIT_IMPORT_SAMPLE_ROWS}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: unitsQueryKeys.all })}
        />
      </DialogContent>
    </Dialog>
  );
}
