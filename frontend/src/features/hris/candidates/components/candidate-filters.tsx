"use client";

import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";
import type { Brand } from "@/types";

export interface CandidateFilterValues {
  status: string;
  brand_id: string;
  position_id: string;
  search: string;
  date_from: string;
  date_to: string;
}

export const EMPTY_CANDIDATE_FILTER: CandidateFilterValues = {
  status: "",
  brand_id: "",
  position_id: "",
  search: "",
  date_from: "",
  date_to: "",
};

interface CandidateFiltersProps {
  filter: CandidateFilterValues;
  searchInput: string;
  brands: Brand[];
  onSearchInput: (value: string) => void;
  onChange: (patch: Partial<CandidateFilterValues>) => void;
}

export function CandidateFilters({ filter, searchInput, brands, onSearchInput, onChange }: CandidateFiltersProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Cari nama, email, telepon..."
              value={searchInput}
              onChange={(e) => onSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* horizontal scroll di mobile */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <Select value={filter.status} onValueChange={(v) => onChange({ status: !v || v === "all" ? "" : v })}>
              <SelectTrigger className="w-[140px] flex-shrink-0">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(CANDIDATE_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter.brand_id} onValueChange={(v) => onChange({ brand_id: !v || v === "all" ? "" : v })}>
              <SelectTrigger className="w-[140px] flex-shrink-0">
                <SelectValue placeholder={brands.find((b) => b.id === filter.brand_id)?.name ?? "Pilih Outlet"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Outlet</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={filter.date_from}
              onChange={(e) => onChange({ date_from: e.target.value })}
              className="w-[130px] flex-shrink-0 text-sm"
              title="Dari tanggal"
            />
            <Input
              type="date"
              value={filter.date_to}
              onChange={(e) => onChange({ date_to: e.target.value })}
              className="w-[130px] flex-shrink-0 text-sm"
              title="Sampai tanggal"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
