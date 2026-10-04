"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { todayWib } from "@/lib/dates";
import { CalendarPlus, ClipboardList, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useLogbookEntries, useLogbookTemplates } from "../queries";
import {
  useCreateLogbookEntry,
  useDeleteLogbookEntry,
  useUpdateLogbookEntryStatus,
  useUpdateLogbookItem,
} from "../mutations";
import type { LogbookEntry, LogbookEntryItem } from "../types";
import { LogbookEntryChecklist } from "./entry-checklist";
import { LogbookNoteDialog } from "./note-dialog";
import { LogbookStatusBadge } from "./logbook-status";
import { LogbookQueryError } from "./query-error";

/**
 * Tab Checklist — alur template-first sesuai keputusan owner:
 * 1) pilih template (atau buat baru via tab Template), 2) generate logbook
 * utk tanggal terpilih, 3) isi checklist & submit.
 */
export function LogbookChecklistTab({
  departmentId,
  onGoToTemplates,
}: {
  departmentId: string;
  onGoToTemplates: () => void;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [entryDate, setEntryDate] = useState(() => todayWib());
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [noteItem, setNoteItem] = useState<LogbookEntryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LogbookEntry | null>(null);

  const templatesQuery = useLogbookTemplates({
    department_id: departmentId || undefined,
  });
  const entriesQuery = useLogbookEntries({
    department_id: departmentId || undefined,
    date: entryDate,
    limit: 50,
  });

  const templates = templatesQuery.data ?? [];
  const entries = useMemo(
    () => entriesQuery.data?.data ?? [],
    [entriesQuery.data]
  );
  const selectedEntry =
    entries.find((entry) => entry.id === selectedEntryId) || entries[0] || null;

  const createEntryMutation = useCreateLogbookEntry();
  const updateItemMutation = useUpdateLogbookItem();
  const updateStatusMutation = useUpdateLogbookEntryStatus();
  const deleteEntryMutation = useDeleteLogbookEntry();

  async function createEntry() {
    if (!selectedTemplate) {
      toast.error("Pilih template terlebih dulu");
      return;
    }
    try {
      const res = await createEntryMutation.mutateAsync({
        template_id: selectedTemplate,
        entry_date: entryDate,
      });
      setSelectedEntryId(res.data?.id || "");
      toast.success("Logbook berhasil dibuat dari template");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat logbook");
    }
  }

  async function toggleItem(item: LogbookEntryItem, checked: boolean) {
    try {
      await updateItemMutation.mutateAsync({ item_id: item.id, is_checked: checked });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal update checklist");
    }
  }

  async function saveNote(itemId: string, notes: string) {
    try {
      await updateItemMutation.mutateAsync({ item_id: itemId, notes });
      setNoteItem(null);
      toast.success("Catatan tersimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan catatan");
    }
  }

  async function submitEntry(entryId: string) {
    try {
      await updateStatusMutation.mutateAsync({ action: "submit-entry", entry_id: entryId });
      toast.success("Logbook disubmit — menunggu review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal submit logbook");
    }
  }

  async function deleteEntry() {
    if (!deleteTarget) return;
    try {
      await deleteEntryMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedEntryId("");
      toast.success("Logbook draft dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus logbook");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="h-4 w-4" /> Buat Logbook Harian
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Mulai dari template: pilih template checklist department, lalu
            generate logbook untuk tanggal terpilih.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_auto_auto]">
          <div className="space-y-1">
            <Label>1. Template</Label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    templates.length
                      ? "Pilih template checklist"
                      : "Belum ada template — buat dulu"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.department?.name ? ` — ${template.department.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>2. Tanggal</Label>
            <Input
              type="date"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={createEntry} disabled={createEntryMutation.isPending}>
              {createEntryMutation.isPending ? "Membuat..." : "Buat Logbook"}
            </Button>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={onGoToTemplates}>
              Buat Template Baru
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Logbook {entryDate}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {entriesQuery.isLoading && <SkeletonCard />}
            {entriesQuery.isError && <LogbookQueryError error={entriesQuery.error} />}
            {!entriesQuery.isLoading && !entriesQuery.isError && entries.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Belum ada logbook pada tanggal ini.
                <br />
                Generate dari template di atas.
              </p>
            )}
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedEntryId(entry.id)}
                className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${
                  selectedEntry?.id === entry.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{entry.title}</p>
                  <LogbookStatusBadge status={entry.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.department?.name} · {entry.entry_date}
                </p>
                <div className="mt-3 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${entry.completion_percentage || 0}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.completion_percentage || 0}% selesai · KPI{" "}
                  {entry.kpi_score || 0}%
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedEntry && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Pilih logbook dari daftar di samping.
              </p>
            )}
            {selectedEntry && (
              <div className="space-y-4">
                <LogbookEntryChecklist
                  entry={selectedEntry}
                  canEdit={selectedEntry.status === "draft"}
                  onToggle={toggleItem}
                  onOpenNote={setNoteItem}
                />
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    onClick={() => submitEntry(selectedEntry.id)}
                    disabled={
                      selectedEntry.status !== "draft" ||
                      updateStatusMutation.isPending
                    }
                  >
                    <Send className="mr-1 h-3 w-3" /> Submit Logbook
                  </Button>
                  {selectedEntry.status === "draft" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteTarget(selectedEntry)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Hapus Draft
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LogbookNoteDialog
        item={noteItem}
        saving={updateItemMutation.isPending}
        onClose={() => setNoteItem(null)}
        onSave={saveNote}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus logbook draft?"
        description={`Logbook "${deleteTarget?.title ?? ""}" beserta checklist-nya akan dihapus permanen.`}
        confirmLabel="Hapus"
        loadingLabel="Menghapus..."
        loading={deleteEntryMutation.isPending}
        variant="danger"
        onConfirm={deleteEntry}
      />
    </div>
  );
}
