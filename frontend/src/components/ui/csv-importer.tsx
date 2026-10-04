"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Download, FileText, CheckCircle, XCircle, AlertCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface CsvImporterHandle {
  import: () => Promise<void>;
  downloadTemplate: () => void;
  reset: () => void;
}

export interface CsvImporterState {
  isImporting: boolean;
  canImport: boolean;
  validCount: number;
  invalidCount: number;
}

interface CsvImporterProps {
  title: string;
  description: string;
  templateName: string;
  apiEndpoint: string;
  onSuccess?: (result: ImportResult) => void;
  onStateChange?: (state: CsvImporterState) => void;
  sampleRows?: Array<Record<string, string>>;
  embedded?: boolean;
  hideHeader?: boolean;
  hideActions?: boolean;
  suppressSuccessToast?: boolean;
  expanded?: boolean;
  columns: CsvColumn[];
}

interface CsvColumn {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "date" | "email";
  description?: string;
}

interface PreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  errors: string[];
}

export interface ImportResult {
  success: boolean;
  imported: number;
  updated?: number;
  skipped: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
}

function escapeCsvValue(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildDefaultExampleRow(columns: CsvColumn[]) {
  return columns
    .map((col) => {
      if (col.key === "email") return "email@example.com";
      if (col.key === "status") return "active";
      if (col.key === "kategori") return "BAHAN_PANGAN";
      if (col.key === "coa") return "PRODUCTION";
      if (col.type === "number") return "0";
      if (col.type === "date") return "YYYY-MM-DD";
      if (col.key === "satuan_besar_kode") return "KG";
      if (col.key === "satuan_kecil_kode") return "GR";
      if (col.key === "konversi_factor") return "1000";
      if (col.key === "opening_stock") return "0";
      if (col.key === "stall_code" || col.key === "warehouse_code") return "MAIN";
      return `sample_${col.key}`;
    })
    .join(",");
}

function parseCSV(text: string): string[][] {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else current += char;
    }
    result.push(current.trim());
    return result;
  });
}

function validateRow(
  columns: CsvColumn[],
  row: Record<string, string>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  columns.forEach((col) => {
    const value = row[col.key]?.trim();

    if (col.required && !value) {
      errors.push(`${col.label} wajib diisi`);
    }

    if (value) {
      if (col.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push(`${col.label} harus berupa email yang valid`);
      }

      if (col.type === "number" && Number.isNaN(Number(value))) {
        errors.push(`${col.label} harus berupa angka`);
      }

      if (col.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`${col.label} harus memakai format YYYY-MM-DD`);
      }
    }
  });

  return { isValid: errors.length === 0, errors };
}

export const CsvImporter = forwardRef<CsvImporterHandle, CsvImporterProps>(function CsvImporter(
  {
    title,
    description,
    templateName,
    apiEndpoint,
    onSuccess,
    onStateChange,
    sampleRows,
    embedded = false,
    hideHeader = false,
    hideActions = false,
    suppressSuccessToast = false,
    expanded = false,
    columns,
  },
  ref
) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validCount = previewData.filter((row) => row.isValid).length;
  const invalidCount = previewData.filter((row) => !row.isValid).length;
  const canImport = Boolean(file && previewData.length > 0 && invalidCount === 0 && !importResult);

  useEffect(() => {
    onStateChange?.({ isImporting, canImport, validCount, invalidCount });
  }, [isImporting, canImport, validCount, invalidCount, onStateChange]);

  const downloadTemplate = useCallback(() => {
    const headers = columns.map((col) => col.key).join(",");
    const dataRows =
      sampleRows && sampleRows.length > 0
        ? sampleRows.map((row) =>
            columns.map((col) => escapeCsvValue(row[col.key] ?? "")).join(",")
          )
        : [buildDefaultExampleRow(columns)];

    const csvContent = [headers, ...dataRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = templateName;
    link.click();
  }, [columns, sampleRows, templateName]);

  const resetImport = useCallback(() => {
    setFile(null);
    setPreviewData([]);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleFile = useCallback(
    (selectedFile: File) => {
      const lowerName = selectedFile.name.toLowerCase();
      const isCsv =
        selectedFile.type === "text/csv" || lowerName.endsWith(".csv");
      const isXlsx =
        selectedFile.type.includes("spreadsheet") ||
        lowerName.endsWith(".xlsx") ||
        lowerName.endsWith(".xls");

      if (!isCsv && !isXlsx) {
        toast.error("Format file tidak valid", {
          description: "Silakan unggah file CSV atau Excel (.xlsx).",
        });
        return;
      }

      setFile(selectedFile);
      setImportResult(null);

      const reader = new FileReader();
      reader.onload = async (e) => {
        let rows: string[][] = [];

        if (isXlsx) {
          const buffer = e.target?.result as ArrayBuffer;
          // ExcelJS gantikan `xlsx` (SheetJS) yang rentan prototype pollution/
          // ReDoS. Dimuat dinamis → hanya masuk bundle saat user pilih .xlsx.
          const excelMod = await import("exceljs");
          const ExcelJS = (excelMod as unknown as { default?: typeof excelMod }).default ?? excelMod;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          const worksheet = workbook.worksheets[0];
          if (!worksheet) {
            toast.error("File kosong", {
              description: "File Excel tidak memiliki worksheet.",
            });
            return;
          }
          const matrix: unknown[][] = [];
          let maxCols = 0;
          worksheet.eachRow({ includeEmpty: true }, (row) => {
            const values = (row.values as unknown[]).slice(1); // 1-indeks → buang [0]
            matrix.push(values);
            if (values.length > maxCols) maxCols = values.length;
          });
          rows = matrix.map((row) =>
            Array.from({ length: maxCols }, (_, i) => {
              const cell = row[i];
              if (cell === null || cell === undefined) return "";
              if (typeof cell === "object") {
                const obj = cell as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
                if (Array.isArray(obj.richText)) return obj.richText.map((r) => String(r.text ?? "")).join("").trim();
                if ("text" in obj) return String(obj.text ?? "").trim();
                if ("result" in obj) return String(obj.result ?? "").trim();
              }
              return String(cell).trim();
            })
          );
        } else {
          rows = parseCSV(e.target?.result as string);
        }

        if (rows.length < 2) {
          toast.error("File kosong", {
            description: "File harus memuat baris header dan minimal satu baris data.",
          });
          return;
        }

        const headers = rows[0].map((header) => header.toLowerCase().replace(/\s+/g, "_"));
        const preview: PreviewRow[] = [];

        for (let i = 1; i < rows.length; i++) {
          const rowData: Record<string, string> = {};
          headers.forEach((header, index) => {
            rowData[header] = rows[i][index] || "";
          });

          const validation = validateRow(columns, rowData);
          preview.push({
            rowNumber: i + 1,
            data: rowData,
            ...validation,
          });
        }

        setPreviewData(preview);
      };

      if (isXlsx) reader.readAsArrayBuffer(selectedFile);
      else reader.readAsText(selectedFile);
    },
    [columns]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFile(droppedFile);
      }
    },
    [handleFile]
  );

  const handleImport = useCallback(async () => {
    if (!file || previewData.length === 0 || invalidCount > 0) return;

    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("columns", JSON.stringify(columns));

      const response = await fetch(apiEndpoint, {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as ImportResult & { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(result.error || result.message || "Impor gagal");
      }

      setImportResult(result);

      if (!suppressSuccessToast) {
        const updated = Number(result.updated ?? 0);
        const imported = Number(result.imported ?? 0);
        const parts: string[] = [];
        if (imported > 0) parts.push(`${imported} diimpor`);
        if (updated > 0) parts.push(`${updated} diperbarui`);
        toast.success("Impor berhasil", {
          description: parts.length > 0 ? parts.join(", ") + "." : "Impor selesai.",
        });
      }

      onSuccess?.(result);
    } catch (error: unknown) {
      toast.error("Impor gagal", {
        description: error instanceof Error ? error.message : "Impor gagal",
      });
    } finally {
      setIsImporting(false);
    }
  }, [
    apiEndpoint,
    columns,
    file,
    invalidCount,
    onSuccess,
    previewData.length,
    suppressSuccessToast,
  ]);

  useImperativeHandle(ref, () => ({
    import: handleImport,
    downloadTemplate,
    reset: resetImport,
  }));

  const previewRows = expanded ? previewData : previewData.slice(0, 10);
  const previewColumns = expanded ? columns : columns.slice(0, 5);
  const scrollPanelClass = expanded
    ? "min-h-[min(52vh,520px)] max-h-[calc(100vh-17rem)] flex-1 overflow-auto"
    : "max-h-60 overflow-y-auto";
  const errorPanelClass = expanded
    ? "min-h-[min(40vh,400px)] max-h-[calc(100vh-20rem)] flex-1 overflow-auto"
    : "max-h-40 overflow-y-auto";
  const errorRows = expanded ? importResult?.errors ?? [] : (importResult?.errors ?? []).slice(0, 10);

  const body = (
    <div className={expanded ? "flex min-h-0 flex-1 flex-col space-y-4" : "space-y-4"}>
      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? "border-pink-400 bg-pink-50/60"
              : "border-gray-200/80 hover:border-gray-300"
          }`}
        >
          <Upload className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p className="mb-2 text-sm text-gray-600">Seret dan lepas file CSV atau Excel di sini, atau</p>
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Pilih File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0];
              if (selectedFile) {
                handleFile(selectedFile);
              }
            }}
          />
          <p className="mt-4 text-xs text-gray-500">Format yang diterima: CSV, Excel (.xlsx)</p>
        </div>
      ) : (
        <div className={expanded ? "flex min-h-0 flex-1 flex-col space-y-4" : "space-y-4"}>
          <div className="flex items-center justify-between rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-pink-600" />
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(2)} KB • {previewData.length} baris
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={validCount > 0 ? "default" : "secondary"}>
                <CheckCircle className="mr-1 h-3 w-3" />
                {validCount} valid
              </Badge>
              {invalidCount > 0 && (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" />
                  {invalidCount} error
                </Badge>
              )}
              <Button type="button" variant="ghost" size="icon" onClick={resetImport} aria-label="Hapus file">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {importResult ? (
            <div className={expanded ? "flex min-h-0 flex-1 flex-col space-y-3" : "space-y-3"}>
              <div className="shrink-0 rounded-lg border border-emerald-200/80 bg-emerald-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <span className="font-medium text-emerald-900">Impor selesai</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-emerald-700">Diimpor:</span>
                    <span className="ml-2 font-semibold">{importResult.imported}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700">Diperbarui:</span>
                    <span className="ml-2 font-semibold">{importResult.updated ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700">Dilewati:</span>
                    <span className="ml-2 font-semibold">{importResult.skipped}</span>
                  </div>
                </div>
              </div>

              {importResult.errors?.length > 0 && (
                <div
                  className={
                    expanded
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-red-200/80 bg-red-50"
                      : "rounded-lg border border-red-200/80 bg-red-50 p-4"
                  }
                >
                  <div className={expanded ? "shrink-0 border-b border-red-200/70 px-4 py-3" : "mb-2"}>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-red-600" />
                      <span className="font-medium text-red-900">
                        Kesalahan ({importResult.errors.length})
                      </span>
                    </div>
                  </div>
                  <div className={expanded ? errorPanelClass : `${errorPanelClass} space-y-1 px-4 pb-4 text-sm text-red-800`}>
                    {expanded ? (
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-red-50">
                          <tr className="border-b border-red-200/70 text-xs uppercase tracking-wide text-red-700">
                            <th className="w-20 px-4 py-3 text-left font-semibold">Baris</th>
                            <th className="px-4 py-3 text-left font-semibold">Pesan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-200/50 text-red-800">
                          {errorRows.map((err) => (
                            <tr key={`${err.row}-${err.message}`} className="hover:bg-red-100/40">
                              <td className="px-4 py-3 font-medium">{err.row}</td>
                              <td className="px-4 py-3">{err.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      errorRows.map((err) => (
                        <div key={`${err.row}-${err.message}`}>
                          Baris {err.row}: {err.message}
                        </div>
                      ))
                    )}
                  </div>
                  {!expanded && importResult.errors.length > 10 && (
                    <p className="px-4 pb-4 text-xs text-red-600">
                      ...dan {importResult.errors.length - 10} kesalahan lainnya
                    </p>
                  )}
                </div>
              )}

              <Button
                type="button"
                onClick={resetImport}
                variant="outline"
                className="shrink-0 w-full purchasing-secondary-button"
              >
                Impor File Lain
              </Button>
            </div>
          ) : (
            <>
              {previewData.length > 0 && (
                <div
                  className={
                    expanded
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/70"
                      : "overflow-hidden rounded-lg border border-gray-200/70"
                  }
                >
                  <div className="shrink-0 border-b border-gray-200/70 bg-gray-50 px-4 py-2">
                    <p className="text-sm font-medium text-gray-700">
                      Pratinjau {expanded ? `(${previewData.length} baris)` : ""}
                    </p>
                  </div>
                  <div className={scrollPanelClass}>
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-gray-50">
                        <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-4 py-3 text-left font-semibold">#</th>
                          {previewColumns.map((col) => (
                            <th key={col.key} className="whitespace-nowrap px-4 py-3 text-left font-semibold">
                              {col.label}
                            </th>
                          ))}
                          <th className="px-4 py-3 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200/70">
                        {previewRows.map((row) => (
                          <tr key={row.rowNumber} className={row.isValid ? "hover:bg-gray-50/80" : "bg-red-50/80"}>
                            <td className="px-4 py-3 text-gray-500">{row.rowNumber}</td>
                            {previewColumns.map((col) => (
                              <td key={col.key} className="whitespace-nowrap px-4 py-3 text-gray-900">
                                {row.data[col.key] || "—"}
                              </td>
                            ))}
                            <td className="px-4 py-3">
                              {row.isValid ? (
                                <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                                  <CheckCircle className="mr-1 h-3 w-3" />
                                  Valid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-red-200 text-red-700">
                                  <XCircle className="mr-1 h-3 w-3" />
                                  {row.errors.length} error
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!expanded && previewData.length > 10 && (
                      <div className="border-t border-gray-200/70 bg-gray-50 px-4 py-2 text-center text-xs text-gray-500">
                        ...dan {previewData.length - 10} baris lainnya
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!hideActions && (
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={resetImport} className="flex-1 purchasing-secondary-button">
                    Batal
                  </Button>
                  <Button
                    type="button"
                    onClick={handleImport}
                    disabled={isImporting || invalidCount > 0}
                    className="flex-1 purchasing-main-button"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Mengimpor...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Impor {validCount} Data
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      {!hideHeader && (
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-pink-600" />
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={downloadTemplate}
              size="sm"
              className="purchasing-secondary-button"
            >
              <Download className="mr-2 h-4 w-4" />
              Unduh Template
            </Button>
          </div>
        </CardHeader>
      )}
      <CardContent className="space-y-4 p-4">{body}</CardContent>
    </Card>
  );
});
