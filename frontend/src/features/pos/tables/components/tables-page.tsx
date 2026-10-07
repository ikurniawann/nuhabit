"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, QrCode, RefreshCw, Search, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { cn } from "@/lib/utils";
import { usePosTables } from "../queries";
import {
  useCreatePosTable,
  useDeletePosTable,
  useUpdatePosTable,
} from "../mutations";
import { generateTableQrCode } from "@/lib/pos/tables/qr-code";
import { FLOOR_LABEL, FLOOR_PRESETS } from "../floor-options";
import type { PosTablePayload, PosTableRow, PosTableStatus } from "../types";
import { TablesFloorPlan } from "./tables-floor-plan";
import { TableQrDialog } from "./table-qr-dialog";

type ViewMode = "list" | "denah";

const EMPTY_FORM: PosTablePayload = {
  table_number: "",
  name: "",
  floor: "",
  area: "",
  capacity: 4,
  status: "available",
  qr_code: "",
  notes: "",
  is_active: true,
};

const AREA_PRESETS = [
  { value: "Indoor", label: "Indoor" },
  { value: "Outdoor", label: "Outdoor" },
  { value: "VIP", label: "VIP" },
  { value: "Terrace", label: "Terrace" },
  { value: "Rooftop", label: "Rooftop" },
  { value: "Smoking", label: "Smoking" },
  { value: "Non-Smoking", label: "Non-Smoking" },
];

const STATUS_OPTIONS: { value: PosTableStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "maintenance", label: "Maintenance" },
  { value: "occupied", label: "Occupied" },
];

const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  unavailable: "Inactive",
};

function mergeOptions(
  presets: readonly { value: string; label: string }[],
  extras: Array<string | null | undefined>
) {
  const map = new Map(presets.map((o) => [o.value, o]));
  for (const raw of extras) {
    const value = String(raw ?? "").trim();
    if (!value || map.has(value)) continue;
    map.set(value, { value, label: value });
  }
  return [...map.values()];
}

function statusTone(status: string) {
  switch (status) {
    case "available":
      return "bg-emerald-50 text-emerald-700";
    case "occupied":
      return "bg-amber-50 text-amber-700";
    case "reserved":
      return "bg-blue-50 text-blue-700";
    case "maintenance":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function TablesPage() {
  const { data: tables = [], isLoading, error } = usePosTables(true);
  const createMutation = useCreatePosTable();
  const updateMutation = useUpdatePosTable();
  const deleteMutation = useDeletePosTable();

  const [view, setView] = useState<ViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<PosTableRow | null>(null);
  const [form, setForm] = useState<PosTablePayload>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<PosTableRow | null>(null);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filtered = useMemo(() => {
    if (!search) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) => {
      const haystack = [
        t.table_number,
        t.name,
        t.label,
        t.floor,
        t.area,
        t.qr_code,
        t.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tables, search]);

  const floorOptions = useMemo(
    () => mergeOptions(FLOOR_PRESETS, [...tables.map((t) => t.floor), form.floor]),
    [tables, form.floor]
  );

  const areaOptions = useMemo(
    () => mergeOptions(AREA_PRESETS, [...tables.map((t) => t.area), form.area]),
    [tables, form.area]
  );

  function openAdd() {
    setForm({
      ...EMPTY_FORM,
      qr_code: generateTableQrCode(),
    });
    setSelected(null);
    setDialog("add");
  }

  function openEdit(item: PosTableRow) {
    setSelected(item);
    setForm({
      table_number: item.table_number || "",
      name: item.name || "",
      floor: item.floor || "",
      area: item.area || "",
      capacity: item.capacity || 4,
      status: (["available", "occupied", "reserved", "maintenance"].includes(
        item.status
      )
        ? item.status
        : "available") as PosTableStatus,
      qr_code: item.qr_code || generateTableQrCode(item.table_number),
      notes: item.notes || "",
      is_active: item.is_active !== false,
    });
    setDialog("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.table_number.trim()) {
      toast.error("Table number is required");
      return;
    }
    const payload: PosTablePayload = {
      ...form,
      qr_code:
        form.qr_code?.trim() || generateTableQrCode(form.table_number),
    };
    try {
      if (dialog === "edit" && selected) {
        const res = await updateMutation.mutateAsync({
          id: selected.id,
          ...payload,
        });
        toast.success(res.message || "Table updated");
      } else {
        const res = await createMutation.mutateAsync(payload);
        toast.success(res.message || "Table created");
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save table");
    }
  }

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      const res = await deleteMutation.mutateAsync(deleteId);
      toast.success(res.message || "Table deactivated");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete table");
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
          <p className="mt-1 text-sm text-gray-500">
            Dine-in table master — {tables.length} tables
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setView("list")}
              className={cn(
                "h-10 flex-1 rounded-lg border-gray-200/80 px-3 text-sm sm:flex-none",
                view === "list" &&
                  "border-primary/40 bg-primary/10 font-semibold text-brand-text hover:bg-primary/15"
              )}
            >
              List
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setView("denah")}
              className={cn(
                "h-10 flex-1 rounded-lg border-gray-200/80 px-3 text-sm sm:flex-none",
                view === "denah" &&
                  "border-primary/40 bg-primary/10 font-semibold text-brand-text hover:bg-primary/15"
              )}
            >
              Floor Plan
            </Button>
          </div>
          <Button
            type="button"
            onClick={openAdd}
            className="h-10 w-full gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
          >
            <PlusIcon className="h-4 w-4" />
            Add Table
          </Button>
        </div>
      </div>

      {view === "list" ? (
        <PurchasingListSection
          icon={Table2}
          title="Table List"
          description="Manage table number, capacity, area, and status for cashier."
          toolbar={
            <label className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search number / area…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-9 pr-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
          }
        >
          {isLoading ? (
            <div className="py-14 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
              <p className="mt-2 text-sm text-gray-500">Loading tables…</p>
            </div>
          ) : error ? (
            <div className="py-14 text-center text-sm text-red-600">
              {error instanceof Error ? error.message : "Failed to load tables"}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center">
              <Table2 className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "No matching tables" : "No tables yet"}
              </p>
              {!search ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openAdd}
                  className="mt-4 h-10 rounded-lg border-primary/30 text-brand-text hover:bg-primary/10"
                >
                  Add First Table
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                    <th className="px-4 py-3 text-left font-semibold">Table No.</th>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Floor</th>
                    <th className="px-4 py-3 text-left font-semibold">Area</th>
                    <th className="px-4 py-3 text-left font-semibold">Capacity</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Active</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </TableRow>
                </thead>
                <tbody className="divide-y divide-gray-200/50">
                  {filtered.map((table) => (
                    <tr
                      key={table.id}
                      className="border-b border-gray-200/70 last:border-0 hover:bg-gray-50/70"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {table.table_number}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {table.name || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {table.floor
                          ? FLOOR_LABEL[table.floor] || table.floor
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {table.area || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {table.capacity}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                            statusTone(table.status)
                          )}
                        >
                          {STATUS_LABEL[table.status] || table.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            table.is_active
                              ? "text-emerald-600"
                              : "text-gray-400"
                          )}
                        >
                          {table.is_active ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setQrTable(table)}
                            className="h-8 w-8 p-0 text-gray-600 hover:bg-gray-100 hover:text-brand-text"
                            aria-label="QR self-order"
                            title="QR self-order"
                          >
                            <QrCode className="h-4 w-4" />
                          </Button>
                          <MasterTableActions
                            onEdit={() => openEdit(table)}
                            onDelete={() => setDeleteId(table.id)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PurchasingListSection>
      ) : isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          <p className="mt-2 text-sm text-gray-500">Loading floor plan…</p>
        </div>
      ) : error ? (
        <div className="py-14 text-center text-sm text-red-600">
          {error instanceof Error ? error.message : "Failed to load tables"}
        </div>
      ) : tables.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white py-14 text-center">
          <p className="text-gray-500">No tables yet</p>
          <Button
            type="button"
            variant="outline"
            onClick={openAdd}
            className="mt-4 h-10 rounded-lg border-gray-200/80"
          >
            Add First Table
          </Button>
        </div>
      ) : (
        <div className="w-full">
          <TablesFloorPlan tables={tables} onEdit={openEdit} />
        </div>
      )}

      <TableQrDialog table={qrTable} onClose={() => setQrTable(null)} />

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && !isSaving && setDialog(null)}
      >
        <DialogPanel size="md">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>
                {dialog === "edit" ? "Edit Table" : "Add Table"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Enter table details for cashier and reservations.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FormFieldLabel required>Table Number</FormFieldLabel>
                  <Input
                    value={form.table_number}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, table_number: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="T-01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Name</FormFieldLabel>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Window table"
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Floor</FormFieldLabel>
                  <Combobox
                    options={floorOptions}
                    value={form.floor ?? ""}
                    onChange={(value) =>
                      setForm((f) => ({ ...f, floor: value }))
                    }
                    placeholder="Select floor…"
                    searchPlaceholder="Search floor…"
                    allowClear
                    className={formComboboxClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Area</FormFieldLabel>
                  <Combobox
                    options={areaOptions}
                    value={form.area ?? ""}
                    onChange={(value) =>
                      setForm((f) => ({ ...f, area: value }))
                    }
                    placeholder="Select area…"
                    searchPlaceholder="Search area…"
                    allowClear
                    className={formComboboxClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel required>Capacity</FormFieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={form.capacity}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        capacity: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                    className={formInputClassName}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Status</FormFieldLabel>
                  <Combobox
                    options={STATUS_OPTIONS}
                    value={form.status}
                    onChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        status: value as PosTableStatus,
                      }))
                    }
                    searchPlaceholder="Search status…"
                    className={formComboboxClassName}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <FormFieldLabel>QR Code</FormFieldLabel>
                  <div className="flex gap-2">
                    <Input
                      value={form.qr_code ?? ""}
                      readOnly
                      className={cn(formInputClassName, "font-mono text-xs")}
                      placeholder="Auto-generated"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSaving}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          qr_code: generateTableQrCode(f.table_number),
                        }))
                      }
                      className="h-10 shrink-0 gap-1.5 rounded-lg border-gray-200/80 px-3"
                      title="Regenerate QR"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Generate
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    QR is generated automatically; regenerate if needed.
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <FormFieldLabel>Notes</FormFieldLabel>
                  <Input
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Optional"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                  <Checkbox
                    checked={form.is_active}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, is_active: checked === true }))
                    }
                  />
                  Active
                </label>
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dialog === "edit" ? (
                  "Save"
                ) : (
                  "Add"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <MasterDeleteDialog
        open={Boolean(deleteId)}
        title="Deactivate table?"
        description="The table will be deactivated (soft delete) to keep order history safe. Tables with an open bill cannot be deleted."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
