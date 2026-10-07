"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useImportCoa } from "../mutations";
import type { CoaImportResult } from "../types";

/** Import COA dari Excel: preview dulu, commit hanya bila tanpa error. */
export function CoaImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="lg">
        {open ? <CoaImportPanel onClose={() => onOpenChange(false)} /> : null}
      </DialogPanel>
    </Dialog>
  );
}

function CoaImportPanel({ onClose }: { onClose: () => void }) {
  const importMutation = useImportCoa();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CoaImportResult | null>(
    null,
  );
  const isImporting = importMutation.isPending;

  async function runImport(mode: "preview" | "commit") {
    if (!importFile || isImporting) return;
    try {
      const res = await importMutation.mutateAsync({ file: importFile, mode });
      setImportResult(res.data);
      if (mode === "commit") {
        toast.success(res.message || "Import berhasil");
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import gagal");
    }
  }

  return (
    <>
      <DialogPanelHeader>
        <DialogPanelTitle>Import Chart of Accounts</DialogPanelTitle>
        <DialogPanelDescription>
          Upload format standar (header code/name) atau file SULU sheet COA.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelToolbar>
        <Input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            setImportFile(e.target.files?.[0] ?? null);
            setImportResult(null);
          }}
          className="h-10 max-w-md border-gray-200/80"
        />
      </DialogPanelToolbar>
      <DialogPanelBody>
        {importResult ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline" className="border-emerald-200/80">
                create {importResult.summary.create}
              </Badge>
              <Badge variant="outline" className="border-sky-200/80">
                update {importResult.summary.update}
              </Badge>
              <Badge variant="outline" className="border-gray-200/80">
                skip {importResult.summary.skip}
              </Badge>
              <Badge variant="outline" className="border-red-200/80">
                error {importResult.summary.error}
              </Badge>
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200/70">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-muted/40 text-left">
                    <th className="px-2 py-2">Row</th>
                    <th className="px-2 py-2">Code</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Action</th>
                    <th className="px-2 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.preview.slice(0, 100).map((p) => (
                    <tr
                      key={`${p.source_row}-${p.code}`}
                      className="border-b border-gray-200/70"
                    >
                      <td className="px-2 py-1.5">{p.source_row}</td>
                      <td className="px-2 py-1.5 font-mono">{p.code}</td>
                      <td className="px-2 py-1.5">{p.name}</td>
                      <td className="px-2 py-1.5">{p.action}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {p.message || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importResult.issues.length > 0 ? (
              <p className="text-xs text-red-600">
                {importResult.issues.length} issue parse — lihat console /
                perbaiki file.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pilih file lalu Preview untuk melihat ringkasan sebelum commit.
          </p>
        )}
      </DialogPanelBody>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isImporting}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Tutup
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!importFile || isImporting}
          onClick={() => runImport("preview")}
          className="h-10 rounded-lg border-gray-200/80"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Preview"
          )}
        </Button>
        <Button
          type="button"
          disabled={
            !importFile ||
            isImporting ||
            !importResult ||
            importResult.summary.error > 0
          }
          onClick={() => runImport("commit")}
          className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Commit"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
