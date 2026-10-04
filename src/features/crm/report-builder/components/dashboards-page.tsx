"use client";

import { useState } from "react";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  useCreateDashboard, useDashboard, useDashboards, useDeleteDashboard, useSavedReports, useUpdateDashboard,
} from "../queries";
import type { DashboardRow, DashboardWidget, WidgetInput } from "../types";
import { ReportKpi, ReportResultView } from "./report-result-view";

const WIDTH_CLASS: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" };

/** EPIC-050 T-4.2 — Dashboard CRM dari report tersimpan. */
export function CrmDashboardsPage() {
  const dashboardsQuery = useDashboards();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<DashboardRow | null>(null);
  const createMutation = useCreateDashboard();
  const deleteMutation = useDeleteDashboard();
  const dashboards = dashboardsQuery.data ?? [];
  const activeId = selectedId ?? dashboards.find((d) => d.is_default)?.id ?? dashboards[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard CRM</h1>
          <p className="mt-1 text-sm text-gray-500">Susun widget dari report tersimpan. Satu dashboard bisa dijadikan Overview untuk seluruh tim.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dashboards.length > 0 ? (
            <Select value={activeId ?? ""} onValueChange={setSelectedId}>
              <SelectTrigger className="h-10 w-56 bg-white"><SelectValue placeholder="Pilih dashboard" /></SelectTrigger>
              <SelectContent>
                {dashboards.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}{d.is_default ? " · Overview" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Dashboard
          </Button>
        </div>
      </div>

      {dashboardsQuery.isLoading ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
      ) : dashboards.length === 0 ? (
        <PurchasingListSection icon={Squares2X2Icon} title="Belum ada dashboard" description="Buat dashboard, lalu tambahkan widget dari report yang sudah disimpan di Report Builder.">
          <p className="py-14 text-center text-sm text-gray-500">Belum ada dashboard.</p>
        </PurchasingListSection>
      ) : activeId ? (
        <DashboardDetailView key={activeId} id={activeId} onDelete={(d) => setDeleting(d)} />
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          {createOpen ? (
            <CreateDashboardForm
              pending={createMutation.isPending}
              onCancel={() => setCreateOpen(false)}
              onSubmit={(v) => createMutation.mutate(v, {
                onSuccess: (body) => {
                  setCreateOpen(false);
                  const id = (body as { id?: string } | undefined)?.id;
                  if (id) setSelectedId(id);
                },
              })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus dashboard?"
        description={`"${deleting?.name ?? ""}" beserta widget-nya dihapus. Report tetap tersimpan.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deleting) {
            deleteMutation.mutate(deleting.id);
            if (selectedId === deleting.id) setSelectedId(null);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function DashboardDetailView({ id, onDelete }: { id: string; onDelete: (d: DashboardRow) => void }) {
  const detailQuery = useDashboard(id);
  const reportsQuery = useSavedReports();
  const updateMutation = useUpdateDashboard();
  const [addOpen, setAddOpen] = useState(false);
  const detail = detailQuery.data;
  const widgets = detail?.widgets ?? [];

  const saveWidgets = (next: DashboardWidget[]) => {
    const payload: WidgetInput[] = next.map((w) => ({ report_id: w.report_id, title: w.title, widget_type: w.widget_type, width: w.width }));
    updateMutation.mutate({ id, values: { widgets: payload } });
  };

  if (detailQuery.isLoading) return <div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>;
  if (!detail) return <p className="py-20 text-center text-sm text-gray-500">Dashboard tidak ditemukan.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200/80 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">
            {detail.dashboard.name}
            {detail.dashboard.is_default ? <Badge className="ml-2 border-0 bg-pink-100 font-normal text-pink-700">Overview</Badge> : null}
          </p>
          <p className="text-xs text-gray-500">{detail.dashboard.description ?? `${widgets.length} widget`}</p>
        </div>
        {!detail.dashboard.is_default ? (
          <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => updateMutation.mutate({ id, values: { is_default: true } })}>
            <Star className="h-4 w-4" /> Jadikan Overview
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Widget
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9 text-red-600 hover:text-red-700" onClick={() => onDelete(detail.dashboard)}>
          Hapus
        </Button>
      </div>

      {widgets.length === 0 ? (
        <PurchasingListSection icon={Squares2X2Icon} title="Belum ada widget" description="Tambahkan widget dari report tersimpan.">
          <p className="py-14 text-center text-sm text-gray-500">Dashboard masih kosong.</p>
        </PurchasingListSection>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {widgets.map((w) => (
            <div key={w.id} className={`rounded-xl border border-gray-200/80 bg-white ${WIDTH_CLASS[w.width] ?? "lg:col-span-1"}`}>
              <div className="flex items-center gap-2 border-b border-gray-200/60 px-4 py-2.5">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{w.title}</p>
                <Select value={String(w.width)} onValueChange={(v) => saveWidgets(widgets.map((x) => (x.id === w.id ? { ...x, width: Number(v) } : x)))}>
                  <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 kolom</SelectItem>
                    <SelectItem value="2">2 kolom</SelectItem>
                    <SelectItem value="3">Penuh</SelectItem>
                  </SelectContent>
                </Select>
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => saveWidgets(widgets.filter((x) => x.id !== w.id))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {w.result ? (
                w.widget_type === "kpi" ? (
                  <ReportKpi result={w.result} />
                ) : (
                  <div className={w.widget_type === "table" ? "" : "px-2 py-3"}>
                    <ReportResultView
                      result={w.result}
                      chartType={w.widget_type === "table" ? "table" : w.definition?.chart_type ?? "column"}
                      height={260}
                      maxRows={8}
                    />
                  </div>
                )
              ) : (
                <p className="px-4 py-10 text-center text-xs text-gray-500">Report tidak tersedia untuk akun ini.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          {addOpen ? (
            <AddWidgetForm
              reports={(reportsQuery.data ?? []).map((r) => ({ id: r.id, name: r.name }))}
              pending={updateMutation.isPending}
              onCancel={() => setAddOpen(false)}
              onSubmit={(v) => {
                const payload: WidgetInput[] = [
                  ...widgets.map((w) => ({ report_id: w.report_id, title: w.title, widget_type: w.widget_type, width: w.width })),
                  v,
                ];
                updateMutation.mutate({ id, values: { widgets: payload } }, { onSuccess: () => setAddOpen(false) });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateDashboardForm({ pending, onCancel, onSubmit }: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: { name: string; description: string | null; is_default: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  return (
    <>
      <DialogHeader><DialogTitle>Dashboard Baru</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5"><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Dashboard Sales Harian" /></div>
        <div className="space-y-1.5"><Label>Deskripsi (opsional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="inline-flex items-center gap-2 text-sm">
          <Switch checked={isDefault} onCheckedChange={(v) => setIsDefault(Boolean(v))} /> Jadikan Overview tim
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button disabled={!name.trim() || pending} onClick={() => onSubmit({ name: name.trim(), description: description.trim() || null, is_default: isDefault })}>
          {pending ? "Menyimpan…" : "Buat"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AddWidgetForm({ reports, pending, onCancel, onSubmit }: {
  reports: Array<{ id: string; name: string }>;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: WidgetInput) => void;
}) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [widgetType, setWidgetType] = useState<WidgetInput["widget_type"]>("chart");
  const [width, setWidth] = useState("1");
  return (
    <>
      <DialogHeader><DialogTitle>Tambah Widget</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Report</Label>
          {reports.length === 0 ? (
            <p className="text-xs text-gray-500">Belum ada report tersimpan. Buat dulu di Report Builder.</p>
          ) : (
            <Select value={reportId} onValueChange={setReportId}>
              <SelectTrigger><SelectValue placeholder="pilih report" /></SelectTrigger>
              <SelectContent>{reports.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1.5"><Label>Judul widget (opsional)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ikut nama report bila kosong" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Tampilan</Label>
            <Select value={widgetType} onValueChange={(v) => setWidgetType(v as WidgetInput["widget_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chart">Grafik report</SelectItem>
                <SelectItem value="table">Tabel</SelectItem>
                <SelectItem value="kpi">Angka tunggal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lebar</Label>
            <Select value={width} onValueChange={setWidth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 kolom</SelectItem>
                <SelectItem value="2">2 kolom</SelectItem>
                <SelectItem value="3">Penuh</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button disabled={!reportId || pending} onClick={() => onSubmit({ report_id: reportId, title: title.trim() || null, widget_type: widgetType, width: Number(width) })}>
          {pending ? "Menyimpan…" : "Tambah"}
        </Button>
      </DialogFooter>
    </>
  );
}
