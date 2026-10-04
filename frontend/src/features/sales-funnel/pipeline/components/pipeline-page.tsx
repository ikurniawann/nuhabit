"use client";

import { formatRupiah } from "@/lib/format";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLinkLeadCustomer } from "../../leads/queries";
import { useDeals, useDeleteDeal, usePipelines, useStages, useUpdateDeal } from "../queries";
import {
  EVENT_TYPE_LABELS,
  type DealFilters,
  type SalesDeal,
  type SalesStage,
} from "../types";
import { CloseDealDialog, type CloseDealTarget } from "./close-deal-dialog";
import { DealCard } from "./deal-card";
import { DealDetailDialog } from "./deal-detail-dialog";
import { DealFormDialog } from "./deal-form-dialog";

const ALL = "all";

const STAGE_HEADER: Record<string, string> = {
  menang: "text-emerald-700",
  kalah: "text-red-600",
};

export function SalesFunnelPipelinePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState(ALL);
  const [pipelineId, setPipelineId] = useState("");
  const pipelinesQuery = usePipelines();
  const pipelines = pipelinesQuery.data ?? [];
  const activePipelineId = pipelineId || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id || "";
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<SalesDeal | null>(null);
  const [editingDeal, setEditingDeal] = useState<SalesDeal | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<SalesDeal | null>(null);
  const [closeTarget, setCloseTarget] = useState<CloseDealTarget | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filters: DealFilters = useMemo(
    () => ({ q: search, event_type: eventType === ALL ? "" : eventType, pipeline_id: activePipelineId }),
    [search, eventType, activePipelineId]
  );

  const stagesQuery = useStages(false, activePipelineId || undefined);
  const dealsQuery = useDeals(filters);
  const updateMutation = useUpdateDeal(filters, () => setCloseTarget(null));
  const deleteMutation = useDeleteDeal();
  const linkMemberMutation = useLinkLeadCustomer();

  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const deals = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);
  const isLoading = stagesQuery.isLoading || dealsQuery.isLoading;

  const byStage = useMemo(() => {
    const map = new Map<string, SalesDeal[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const deal of deals) map.get(deal.stage_id)?.push(deal);
    return map;
  }, [stages, deals]);

  // Detail diambil dari cache agar tetap segar setelah mutasi (pola HRIS);
  // snapshot saat buka jadi cadangan supaya Sheet tidak tertutup sendiri
  // ketika deal-nya keluar dari hasil filter/pencarian yang sedang aktif.
  const detailDeal = detailId
    ? (deals.find((d) => d.id === detailId) ?? detailSnapshot)
    : null;

  const openDeals = deals.filter((d) => !d.closed_at);
  const pipelineValue = openDeals.reduce(
    (acc, d) => acc + Number(d.value_final ?? d.value_estimate ?? 0),
    0
  );

  const moveDeal = (deal: SalesDeal, stage: SalesStage) => {
    if (deal.stage_id === stage.id) return;
    // Menang/Kalah wajib lewat dialog (nilai final / alasan kalah)
    if (stage.is_won || stage.is_lost) {
      setCloseTarget({ deal, stage });
      return;
    }
    updateMutation.mutate({ id: deal.id, values: { stage_id: stage.id } });
  };

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const deal = deals.find((d) => d.id === draggableId);
    const stage = stages.find((s) => s.id === destination.droppableId);
    if (!deal || !stage) return;
    moveDeal(deal, stage);
  };

  return (
    <div className="space-y-5">
      {pipelines.length > 1 ? (
        <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {pipelines.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPipelineId(p.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${activePipelineId === p.id ? "bg-pink-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {p.name}
              <span className={`ml-1.5 text-xs ${activePipelineId === p.id ? "text-pink-100" : "text-gray-400"}`}>{p.open_deals}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Deals</h1>
          <p className="mt-1 text-sm text-gray-500">
            {openDeals.length} deal berjalan · nilai pipeline{" "}
            <span className="font-semibold text-gray-900">
              {formatRupiah(pipelineValue)}
            </span>
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari deal, instansi, PIC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-white pl-9 pr-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-10 bg-white sm:w-40">
              <SelectValue placeholder="Jenis Acara" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Acara</SelectItem>
              {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => setFormOpen(true)}
            className="h-10 gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
          >
            <PlusIcon className="h-4 w-4" />
            Tambah Deal
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat pipeline...</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => {
              const stageDeals = byStage.get(stage.id) ?? [];
              const stageValue = stageDeals.reduce(
                (acc, d) => acc + Number(d.value_final ?? d.value_estimate ?? 0),
                0
              );
              return (
                <div
                  key={stage.id}
                  className="flex w-72 shrink-0 flex-col rounded-2xl border border-gray-200/70 bg-gray-50/80"
                >
                  <div className="flex items-center justify-between px-4 pb-2 pt-3">
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          STAGE_HEADER[stage.code] ?? "text-gray-900"
                        }`}
                      >
                        {stage.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {stageDeals.length} deal · {formatRupiah(stageValue)}
                        {typeof stage.probability === "number" && !stage.is_won && !stage.is_lost ? ` · ${stage.probability}%` : ""}
                      </p>
                    </div>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex min-h-32 flex-1 flex-col gap-2 px-3 pb-3 transition ${
                          snapshot.isDraggingOver ? "bg-pink-50/70" : ""
                        }`}
                      >
                        {stageDeals.map((deal, index) => (
                          <Draggable key={deal.id} draggableId={deal.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                style={dragProvided.draggableProps.style as CSSProperties}
                                className={
                                  dragSnapshot.isDragging
                                    ? "rotate-1 opacity-90 shadow-lg"
                                    : ""
                                }
                              >
                                <DealCard
                                  deal={deal}
                                  onClick={() => {
                                    setDetailId(deal.id);
                                    setDetailSnapshot(deal);
                                  }}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      <DealDetailDialog
        deal={detailDeal}
        onClose={() => {
          setDetailId(null);
          setDetailSnapshot(null);
        }}
        onEdit={(deal) => setEditingDeal(deal)}
      />
      <DealFormDialog
        defaultPipelineId={activePipelineId}
        open={formOpen || editingDeal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditingDeal(null);
          }
        }}
        deal={editingDeal}
        filters={filters}
        onDelete={editingDeal ? () => setDeletingDeal(editingDeal) : undefined}
      />
      <CloseDealDialog
        target={closeTarget}
        onClose={() => setCloseTarget(null)}
        onSubmit={(dealId, values, extras) =>
          updateMutation.mutate(
            { id: dealId, values },
            {
              onSuccess: () => {
                // Alur Fase D: Menang → PIC langsung jadi member loyalty
                if (extras.makeMember) {
                  linkMemberMutation.mutate({
                    leadId: extras.leadId,
                    payload: { create_from_pic: true },
                  });
                }
              },
            }
          )
        }
        isPending={updateMutation.isPending}
      />
      <ConfirmDialog
        open={deletingDeal !== null}
        onOpenChange={(open) => !open && setDeletingDeal(null)}
        title="Hapus deal?"
        description={`Deal "${deletingDeal?.title ?? ""}" akan dihapus dari pipeline. Lead-nya tetap tersimpan.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deletingDeal) deleteMutation.mutate(deletingDeal.id);
          setDeletingDeal(null);
          setEditingDeal(null);
        }}
      />
    </div>
  );
}
