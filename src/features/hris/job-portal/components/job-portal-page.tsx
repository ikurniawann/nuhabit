"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EMPTY_JOB_FORM,
  countJobsByStatus,
  jobToForm,
  toJobPayload,
  type JobForm,
  type JobOpening,
  type JobStatus,
} from "@/lib/recruitment/job-portal-form";
import { useJobOpenings } from "../queries";
import { useSaveJobOpening, useDeleteJobOpening } from "../mutations";
import { JobOpeningDialog } from "./job-opening-dialog";
import { JobOpeningsTable } from "./job-openings-table";

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function JobPortalPage() {
  /** null = dialog tertutup. */
  const [editing, setEditing] = useState<JobForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<JobStatus | "all">("all");

  const { data: jobs = [], isLoading } = useJobOpenings();
  const saveMutation = useSaveJobOpening();
  const deleteMutation = useDeleteJobOpening();

  const filteredJobs = filterStatus === "all" ? jobs : jobs.filter((job) => job.status === filterStatus);
  const counts = countJobsByStatus(jobs);

  async function handleSave(form: JobForm) {
    setError(null);
    try {
      await saveMutation.mutateAsync(toJobPayload(form));
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err, "Gagal menyimpan lowongan"));
    }
  }

  async function handleDelete(job: JobOpening) {
    if (!window.confirm(`Hapus lowongan "${job.title}"?`)) return;
    try {
      await deleteMutation.mutateAsync(job.id);
    } catch (err) {
      setError(errorMessage(err, "Gagal menghapus lowongan"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Portal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Atur lowongan yang tampil di halaman career publik.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/career"
            target="_blank"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-4 w-4" />
            Preview Career
          </Link>
          <Button onClick={() => setEditing(EMPTY_JOB_FORM)} className="h-9 bg-pink-600 text-white hover:bg-pink-700">
            <Plus className="h-4 w-4" />
            Tambah Lowongan
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total Lowongan" value={jobs.length} />
        <SummaryCard label="Published" value={counts.published} />
        <SummaryCard label="Draft" value={counts.draft} />
        <SummaryCard label="Closed" value={counts.closed} />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700">Status</label>
        <select
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value as JobStatus | "all")}
          className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
        >
          <option value="all">Semua</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <JobOpeningsTable
        jobs={filteredJobs}
        loading={isLoading}
        onEdit={(job) => setEditing(jobToForm(job))}
        onDelete={handleDelete}
      />

      {editing && (
        <JobOpeningDialog
          initial={editing}
          saving={saveMutation.isPending}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
