import { Briefcase, CalendarDays, Edit3, Loader2, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { JobOpening, JobStatus } from "@/lib/recruitment/job-portal-form";

const STATUS_CLASS: Record<JobStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-emerald-100 text-emerald-700",
  closed: "bg-red-100 text-red-700",
};

export function JobOpeningsTable({
  jobs, loading, onEdit, onDelete,
}: {
  jobs: JobOpening[];
  loading: boolean;
  onEdit: (job: JobOpening) => void;
  onDelete: (job: JobOpening) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="grid grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] gap-4 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span>Lowongan</span>
        <span>Brand / Posisi</span>
        <span>Lokasi</span>
        <span>Status</span>
        <span>Aksi</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat lowongan...
        </div>
      ) : jobs.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Belum ada lowongan untuk filter ini.
        </div>
      ) : (
        jobs.map((job) => (
          <div
            key={job.id}
            className="grid grid-cols-1 gap-3 border-b border-gray-100 px-4 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] md:items-center"
          >
            <div>
              <div className="font-semibold text-gray-900">{job.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5" />
                  {job.department_ref?.name || job.department}
                </span>
                <span>{job.employment_type}</span>
                <span>{job.work_mode}</span>
                <span>{job.headcount} orang</span>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              <div>{job.brand?.name || "Semua Brand"}</div>
              <div className="text-xs text-gray-400">{job.position?.title || "Tanpa master posisi"}</div>
            </div>
            <div className="inline-flex items-center gap-1 text-sm text-gray-600">
              <MapPin className="h-4 w-4 text-gray-400" />
              {job.location}
            </div>
            <div className="space-y-1">
              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${STATUS_CLASS[job.status]}`}>
                {job.status}
              </span>
              {job.closing_date && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(job.closing_date)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(job)}>
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(job)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
