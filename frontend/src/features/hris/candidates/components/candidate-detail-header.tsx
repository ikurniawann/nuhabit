"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Download,
  Edit3,
  Loader2,
  Mail,
  MoreVertical,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format";
import { CANDIDATE_STATUS_BADGES, CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/recruitment/candidate-query";
import { daysInStage } from "@/lib/recruitment/candidate-timeline";
import type { PipelineStage } from "@/types";
import { StageStepper } from "@/features/hris/pipeline/components/stage-stepper";
import type { CandidateView } from "../types";

interface CandidateDetailHeaderProps {
  candidate: CandidateView;
  status: PipelineStage;
  moving: boolean;
  onMove: (status: PipelineStage) => void;
  onEdit: () => void;
  onDownloadCv: () => void;
  onWhatsApp: () => void;
  onEmail: () => void;
}

const isParked = (status: PipelineStage) => status === "talent_pool" || status === "rejected";

/** Kepala halaman detail: identitas, kontak cepat, menu, dan stepper tahap. */
export function CandidateDetailHeader({
  candidate,
  status,
  moving,
  onMove,
  onEdit,
  onDownloadCv,
  onWhatsApp,
  onEmail,
}: CandidateDetailHeaderProps) {
  const days = daysInStage(candidate.updated_at);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/dashboard/hris/candidates" className="mt-1">
            <Button variant="ghost" size="icon" aria-label="Kembali">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white shadow-sm">
            {candidate.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{candidate.full_name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CANDIDATE_STATUS_BADGES[status]}`}>
                {CANDIDATE_STATUS_LABELS[status]}
              </span>
              {days > 7 && !isParked(status) && (
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    days > 14 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  }`}
                >
                  <Clock className="size-3" /> {days} hari di tahap ini
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Briefcase className="size-3.5" />
                {candidate.positions?.title ?? "Posisi belum diisi"}
              </span>
              {candidate.brands?.name && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="size-3.5" /> {candidate.brands.name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                Apply {formatDate(candidate.created_at)}
              </span>
              <span>
                {CANDIDATE_SOURCE_LABELS[candidate.source as keyof typeof CANDIDATE_SOURCE_LABELS] ?? candidate.source}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {candidate.phone && (
                <button
                  onClick={onWhatsApp}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <Phone className="size-3" /> {candidate.phone}
                </button>
              )}
              {candidate.email && (
                <button
                  onClick={onEmail}
                  className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                >
                  <Mail className="size-3" /> {candidate.email}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit3 className="size-4" /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Menu lainnya" />}>
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDownloadCv}>
                <Download className="size-4" /> Download CV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onWhatsApp}>
                <Phone className="size-4" /> Kirim WhatsApp
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEmail}>
                <Mail className="size-4" /> Kirim Email
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <StageStepper status={status} onMove={onMove} size="lg" />
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant={status === "talent_pool" ? "default" : "outline"}
              className={status === "talent_pool" ? "" : "text-pink-600 hover:bg-pink-50"}
              disabled={moving || status === "talent_pool"}
              onClick={() => onMove("talent_pool")}
            >
              Talent Pool
            </Button>
            <Button
              size="sm"
              variant={status === "rejected" ? "default" : "outline"}
              className={status === "rejected" ? "" : "text-red-600 hover:bg-red-50"}
              disabled={moving || status === "rejected"}
              onClick={() => onMove("rejected")}
            >
              Tolak
            </Button>
          </div>
        </div>
        {moving && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="size-3 animate-spin" /> Memindahkan kandidat…
          </p>
        )}
      </div>
    </div>
  );
}
