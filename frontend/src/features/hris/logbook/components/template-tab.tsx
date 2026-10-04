"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useLogbookTemplates } from "../queries";
import { useCreateLogbookTemplate, useDeleteLogbookTemplate } from "../mutations";
import { LogbookQueryError } from "./query-error";
import type {
  LogbookCurrentUser,
  LogbookDepartment,
  LogbookTemplate,
  LogbookTemplateItem,
} from "../types";

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
  custom: "Kustom",
};

const defaultItem = (): LogbookTemplateItem => ({
  title: "",
  description: "",
  weight: 10,
  is_required: true,
});

/** Tab Template — master data checklist per department (step pertama alur). */
export function LogbookTemplateTab({
  me,
  departmentId,
  departments,
}: {
  me: LogbookCurrentUser | null;
  departmentId: string;
  departments: LogbookDepartment[];
}) {
  const isFullAccess = me?.is_full_access ?? false;
  const [formDepartment, setFormDepartment] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    frequency: "daily",
    items: [defaultItem()],
  });
  const [deleteTarget, setDeleteTarget] = useState<LogbookTemplate | null>(null);

  const templatesQuery = useLogbookTemplates({
    department_id: departmentId || undefined,
    include_inactive: true,
  });
  const templates = templatesQuery.data ?? [];

  const createMutation = useCreateLogbookTemplate();
  const deleteMutation = useDeleteLogbookTemplate();

  // Non-full-access selalu ke department sendiri (server juga memaksa).
  const targetDepartment = isFullAccess
    ? formDepartment || departmentId
    : me?.employee?.department_id || "";

  function updateItem(index: number, patch: Partial<LogbookTemplateItem>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    }));
  }

  async function createTemplate() {
    if (!targetDepartment) {
      toast.error("Pilih department untuk template ini");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Isi nama template");
      return;
    }
    const items = form.items.filter((item) => item.title.trim());
    if (!items.length) {
      toast.error("Minimal satu checklist item harus diisi");
      return;
    }
    try {
      await createMutation.mutateAsync({
        department_id: targetDepartment,
        ...form,
        items,
      });
      setForm({ name: "", description: "", frequency: "daily", items: [defaultItem()] });
      toast.success("Template berhasil dibuat");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat template");
    }
  }

  async function deleteTemplate() {
    if (!deleteTarget) return;
    try {
      const res = await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(res.archived
          ? "Template diarsipkan (sudah dipakai logbook)"
          : "Template dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus template");
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daftar Template</CardTitle>
          <p className="text-sm text-muted-foreground">
            Template adalah master data checklist — logbook harian dibuat dari
            sini.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {templatesQuery.isLoading && <SkeletonCard />}
          {templatesQuery.isError && <LogbookQueryError error={templatesQuery.error} />}
          {!templatesQuery.isLoading && !templatesQuery.isError && templates.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Belum ada template. Buat template pertama di panel samping.
            </p>
          )}
          {templates.map((template) => (
            <div
              key={template.id}
              className={`rounded-lg border p-3 ${
                template.is_active ? "border-border" : "border-dashed opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {template.department?.name} ·{" "}
                    {FREQUENCY_LABELS[template.frequency] ?? template.frequency} ·{" "}
                    {(template.items || []).length} item
                  </p>
                  {template.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!template.is_active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Arsip
                    </Badge>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleteTarget(template)}
                    aria-label={`Hapus template ${template.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buat Template Baru</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isFullAccess ? (
            <div className="space-y-1">
              <Label>Department</Label>
              <Select
                value={formDepartment || departmentId}
                onValueChange={setFormDepartment}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Template dibuat untuk department Anda:{" "}
              <span className="font-medium">
                {me?.employee?.department?.name ?? "-"}
              </span>
            </p>
          )}

          <div className="space-y-1">
            <Label>Nama Template</Label>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Checklist Harian Gudang"
            />
          </div>
          <div className="space-y-1">
            <Label>Deskripsi</Label>
            <Textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="Deskripsi singkat template (opsional)"
            />
          </div>
          <div className="space-y-1">
            <Label>Frekuensi</Label>
            <Select
              value={form.frequency}
              onValueChange={(value) => setForm({ ...form, frequency: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Checklist Item</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    items: [...current.items, defaultItem()],
                  }))
                }
              >
                <Plus className="mr-1 h-3 w-3" /> Item
              </Button>
            </div>
            {form.items.map((item, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex gap-2">
                  <Input
                    value={item.title}
                    onChange={(event) => updateItem(index, { title: event.target.value })}
                    placeholder={`Item ${index + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.filter(
                          (_, itemIndex) => itemIndex !== index
                        ),
                      }))
                    }
                    aria-label={`Hapus item ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bobot KPI</Label>
                  <NumericInput
                    value={item.weight}
                    onValueChange={(value) => updateItem(index, { weight: value })}
                    decimalScale={0}
                  />
                </div>
              </div>
            ))}
          </div>

          <Button
            className="w-full"
            onClick={createTemplate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Menyimpan..." : "Simpan Template"}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus template?"
        description={
          `Template "${deleteTarget?.name ?? ""}" akan dihapus permanen bila belum ` +
          "pernah dipakai logbook; bila sudah, template diarsipkan."
        }
        confirmLabel="Hapus"
        loadingLabel="Menghapus..."
        loading={deleteMutation.isPending}
        variant="danger"
        onConfirm={deleteTemplate}
      />
    </div>
  );
}
