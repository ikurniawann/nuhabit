"use client";

import { useCallback, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/iam/can";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  importFile,
  ROW_STATUS_LABEL,
  summarize,
  writableRows,
  type ImportReport,
  type ImportRowStatus,
} from "./api";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Apa yang diimpor dan kunci alaminya, misalnya "Nama jenis kelas sebagai kunci". */
  description: string;
  /** Endpoint POST impor Go, misalnya /api/gym/class-types/import. */
  endpoint: string;
  /** Endpoint GET template CSV. */
  templateHref: string;
  /** Dipanggil setelah commit berhasil, untuk memuat ulang daftar. */
  onImported?: (report: ImportReport) => void;
}

const STATUS_VARIANT: Record<ImportRowStatus, "success" | "info" | "muted" | "warning" | "destructive"> = {
  created: "success",
  updated: "info",
  unchanged: "muted",
  skipped: "warning",
  error: "destructive",
};

/**
 * Impor data dari CSV/XLSX: pilih file, server memvalidasi semua baris
 * tanpa menulis (dry run), tabel pratinjau menunjukkan status tiap baris,
 * lalu "Terapkan" menjalankan impor yang sama dan menyimpannya.
 */
export function ImportDialog({ open, onOpenChange, title, description, endpoint, templateHref, onImported }: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <ImportBody endpoint={endpoint} templateHref={templateHref} onImported={onImported} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportBody({
  endpoint,
  templateHref,
  onImported,
  onClose,
}: Pick<ImportDialogProps, "endpoint" | "templateHref" | "onImported"> & { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = useCallback(
    async (picked: File) => {
      const name = picked.name.toLowerCase();
      if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        toast.error("Format file tidak didukung", { description: "Unggah file CSV atau Excel (.xlsx)." });
        return;
      }
      setFile(picked);
      setReport(null);
      setBusy("preview");
      try {
        setReport(await importFile(endpoint, picked, true));
      } catch (error) {
        setFile(null);
        toast.error("File tidak bisa diproses", { description: error instanceof Error ? error.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [endpoint]
  );

  const commit = useCallback(async () => {
    if (!file) return;
    setBusy("commit");
    try {
      const result = await importFile(endpoint, file, false);
      setReport(result);
      toast.success("Impor selesai", { description: summarize(result) });
      onImported?.(result);
    } catch (error) {
      toast.error("Impor gagal", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [endpoint, file, onImported]);

  const reset = () => {
    setFile(null);
    setReport(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const committed = report !== null && !report.dry_run;
  const canCommit = report !== null && report.dry_run && writableRows(report) > 0 && busy === null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={templateHref} download className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline">
          <Download className="size-4" /> Unduh template CSV
        </a>
        {file && (
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy !== null}>
            Pilih file lain
          </Button>
        )}
      </div>

      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) void preview(dropped);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-forest bg-surface" : "border-border hover:border-forest/60"
          )}
        >
          <Upload className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Tarik file ke sini atau klik untuk memilih</p>
          <p className="text-xs text-muted-foreground">CSV (UTF-8) atau XLSX, maksimal 2.000 baris. Isi sesuai header template.</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          {busy === "preview" && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Memeriksa
            </span>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void preview(picked);
        }}
      />

      {report && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{committed ? "Hasil impor" : "Pratinjau"}:</span>
            <span>{summarize(report)}</span>
            {!committed && report.failed > 0 && (
              <span className="text-muted-foreground">Baris yang gagal dilewati saat diterapkan; perbaiki lalu impor ulang.</span>
            )}
          </div>
          <div className="max-h-[48vh] overflow-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Baris</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell className="tabular-nums text-muted-foreground">{row.row}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>{ROW_STATUS_LABEL[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className={cn("text-sm", row.status === "error" ? "text-danger" : "text-muted-foreground")}>
                      {row.message}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy === "commit"}>
          {committed ? "Tutup" : "Batal"}
        </Button>
        {!committed && (
          <Button onClick={() => void commit()} disabled={!canCommit}>
            {busy === "commit" ? <Loader2 className="size-4 animate-spin" /> : null}
            {report && report.dry_run ? `Terapkan ${writableRows(report)} baris` : "Terapkan"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export interface ImportButtonProps extends Omit<ImportDialogProps, "open" | "onOpenChange"> {
  /** Menu IAM yang aksi create-nya menjaga endpoint impor. */
  menu: string | readonly string[];
  label?: string;
}

/** Tombol "Impor CSV" yang membuka ImportDialog; tampil terkunci tanpa izin create. */
export function ImportButton({ menu, label = "Impor CSV", ...dialog }: ImportButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <Can menu={menu} action="create" mode="disable">
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload /> {label}
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} {...dialog} />
    </Can>
  );
}
