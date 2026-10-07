"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CsvImporter,
  type CsvImporterHandle,
  type CsvImporterState,
  type ImportResult,
} from "@/components/ui/csv-importer";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { PRODUCT_IMPORT_COLUMNS } from "@/lib/purchasing/import-columns";
import { PRODUCT_IMPORT_SAMPLE_ROWS } from "../import-sample-rows";

export function ProductsImportPage() {
  const router = useRouter();
  const importerRef = useRef<CsvImporterHandle>(null);
  const [importState, setImportState] = useState<CsvImporterState>({
    isImporting: false,
    canImport: false,
    validCount: 0,
    invalidCount: 0,
  });

  const handleImportSuccess = (result: ImportResult) => {
    const imported = Number(result?.imported ?? 0);
    const updated = Number(result?.updated ?? 0);
    const skipped = Number(result?.skipped ?? 0);

    if (imported > 0 || updated > 0) {
      const parts: string[] = [];
      if (imported > 0) {
        parts.push(`${imported} data baru`);
      }
      if (updated > 0) {
        parts.push(`${updated} data diperbarui`);
      }
      toast.success(`Impor selesai: ${parts.join(", ")}.`);
    } else {
      toast.success("Impor selesai tanpa perubahan.");
    }

    if (skipped > 0) {
      toast.warning(
        `${skipped} baris dilewati. Periksa hasil di bawah sebelum meninggalkan halaman.`
      );
      return;
    }

    if (imported > 0 || updated > 0) {
      router.push(PRODUCT_ROUTES.products);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await importerRef.current?.import();
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.products}
        title="Impor Produk"
        description="Unggah CSV atau Excel untuk menambah produk, atau impor ulang file hasil ekspor untuk memperbarui data yang sudah ada."
        actions={
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button w-full sm:w-auto"
            onClick={() => importerRef.current?.downloadTemplate()}
          >
            <Download className="mr-2 h-4 w-4" />
            Unduh Template
          </Button>
        }
      />

      <form
        id="product-import-form"
        onSubmit={handleSubmit}
        className="flex min-h-[calc(100vh-11rem)] flex-col space-y-6"
      >
        <Card className="flex min-h-0 flex-1 flex-col border-gray-200/70 shadow-xs">
          <CardHeader className="shrink-0 border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-pink-600" />
              Unggah Spreadsheet
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4 p-4">
            <div className="flex shrink-0 items-start gap-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-pink-600" />
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-900">Sebelum mengimpor</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Ekspor dari daftar produk, ubah kolom, lalu impor ulang file yang sama.</li>
                  <li>Kode yang sudah ada diperbarui per stall; kode kosong membuat produk baru.</li>
                  <li>Format yang didukung: CSV dan Excel (.xlsx).</li>
                  <li>
                    Kolom wajib: nama produk (<strong>nama</strong>), kode stall (
                    <strong>stall_code</strong>), dan kode satuan (<strong>satuan_kode</strong>).
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <CsvImporter
                ref={importerRef}
                embedded
                expanded
                hideHeader
                hideActions
                suppressSuccessToast
                title="Impor Produk"
                description="Unggah CSV atau Excel untuk menambah produk secara massal."
                templateName="template-products.csv"
                apiEndpoint="/api/purchasing/import/products"
                sampleRows={PRODUCT_IMPORT_SAMPLE_ROWS}
                columns={PRODUCT_IMPORT_COLUMNS}
                onStateChange={setImportState}
                onSuccess={handleImportSuccess}
              />
            </div>
          </CardContent>
        </Card>

        <div className="shrink-0">
          <PurchasingFormFooter
            formId="product-import-form"
            onCancel={() => router.push(PRODUCT_ROUTES.products)}
            submitLabel={
              importState.validCount > 0
                ? `Impor ${importState.validCount} Data`
                : "Impor"
            }
            loading={importState.isImporting}
            disabled={!importState.canImport}
          />
        </div>
      </form>
    </div>
  );
}
