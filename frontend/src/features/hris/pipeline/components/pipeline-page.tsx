"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PipelineStage } from "@/types";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { filterBoardCandidates, groupByStage } from "@/lib/recruitment/pipeline-board";
import { usePipelineCandidates, usePipelineBrands } from "../queries";
import { useUpdateCandidateStage } from "../mutations";
import { FunnelProgress, PipelineKanban, type PipelineCandidate } from "./pipeline-board";
import { PipelineCandidateSheet } from "./pipeline-candidate-sheet";

const NO_CANDIDATES: PipelineCandidate[] = [];

export function PipelinePage() {
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const candidatesQuery = usePipelineCandidates();
  const brandsQuery = usePipelineBrands();
  const updateStage = useUpdateCandidateStage();

  const candidates: PipelineCandidate[] = candidatesQuery.data ?? NO_CANDIDATES;
  const brands = brandsQuery.data ?? [];

  const byStage = useMemo(
    () => groupByStage(filterBoardCandidates(candidates, selectedBrand, search)),
    [candidates, selectedBrand, search]
  );
  // diambil dari cache supaya selalu segar setelah mutasi
  const selectedCandidate = candidates.find((c) => c.id === selectedId) ?? null;

  const moveSelected = (status: PipelineStage) => {
    if (!selectedCandidate || selectedCandidate.status === status) return;
    updateStage.mutate({ id: selectedCandidate.id, status });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Rekrutmen</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tarik & lepas kandidat antar tahapan, atau klik kartu untuk detail & action.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kandidat…"
              className="h-9 w-56 pl-9 text-sm"
            />
          </div>
          <Select value={selectedBrand} onValueChange={setSelectedBrand}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="Semua Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Brand</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <FunnelProgress byStage={byStage} />

      <PipelineKanban
        byStage={byStage}
        onMove={(id, status) => updateStage.mutate({ id, status })}
        onSelect={(id) => {
          setSelectedId(id);
          setSheetOpen(true);
        }}
      />

      <PipelineCandidateSheet
        candidate={selectedCandidate}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onMove={moveSelected}
        moving={updateStage.isPending}
      />
    </div>
  );
}
