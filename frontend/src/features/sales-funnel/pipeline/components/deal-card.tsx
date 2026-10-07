"use client";

import { CalendarDays, Flame, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ORG_TYPE_LABELS } from "../../leads/types";
import {
  EVENT_TYPE_LABELS,
  daysInStage,
  formatEventDate,
  formatRupiahOrDash,
  isDealStuck,
  type SalesDeal,
} from "../types";

const EVENT_BADGE: Record<string, string> = {
  gathering: "border-0 bg-indigo-100 font-normal text-indigo-700",
  "field-trip": "border-0 bg-emerald-100 font-normal text-emerald-700",
  "ulang-tahun": "border-0 bg-amber-100 font-normal text-amber-700",
  "buyout-venue": "border-0 bg-purple-100 font-normal text-purple-700",
  lainnya: "border-0 bg-gray-100 font-normal text-gray-600",
};

interface DealCardProps {
  deal: SalesDeal;
  onClick: () => void;
}

export function DealCard({ deal, onClick }: DealCardProps) {
  const stuck = isDealStuck(deal);
  const eventDate = formatEventDate(deal);
  const value = deal.value_final ?? deal.value_estimate;

  return (
    // Sengaja div, BUKAN <button>: @hello-pangea/dnd memblokir drag yang
    // dimulai dari elemen interaktif, jadi kartu <button> tak bisa digeser
    // (pola sama dengan kartu kanban pipeline HRIS).
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full cursor-pointer rounded-xl border border-gray-200/80 bg-white p-3 text-left shadow-sm transition hover:border-pink-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{deal.title}</p>
        {stuck ? (
          <Badge className="shrink-0 border-0 bg-red-100 font-normal text-red-700">
            <Flame className="mr-1 h-3 w-3" />
            Macet {daysInStage(deal.entered_stage_at)}h
          </Badge>
        ) : null}
      </div>

      <p className="mt-0.5 text-xs text-gray-500">
        {deal.org_name} · {ORG_TYPE_LABELS[deal.org_type]}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge className={EVENT_BADGE[deal.event_type]}>
          {EVENT_TYPE_LABELS[deal.event_type]}
        </Badge>
        {deal.pax_estimate ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Users className="h-3 w-3" />
            {deal.pax_estimate} pax
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-gray-900">{formatRupiahOrDash(value)}</span>
        {eventDate ? (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <CalendarDays className="h-3 w-3" />
            {eventDate}
          </span>
        ) : null}
      </div>

      {deal.owner_name || deal.lost_reason_name ? (
        <div className="mt-2 border-t border-gray-100 pt-1.5 text-xs text-gray-500">
          {deal.lost_reason_name ? (
            <span className="text-red-600">Kalah: {deal.lost_reason_name}</span>
          ) : (
            <span>PJ: {deal.owner_name}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
