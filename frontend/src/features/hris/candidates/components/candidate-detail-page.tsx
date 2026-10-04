"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Edit3, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";
import { buildCandidateTimelines } from "@/lib/recruitment/candidate-timeline";
import { buildWaLink } from "@/lib/recruitment/wa";
import type { PipelineStage } from "@/types";
import { useCandidateDetail } from "../queries";
import { useUpdateCandidateStatus } from "../mutations";
import { CandidateDetailHeader } from "./candidate-detail-header";
import { CandidateStagePanel } from "./candidate-stage-panel";
import { CandidateProfileCard } from "./candidate-profile-card";
import { CandidateAiSummary, CandidateDocuments, CandidateTimeline } from "./candidate-side-panels";

function CandidateNotFound() {
  return (
    <div className="flex items-center justify-center py-16">
      <Card className="max-w-md">
        <CardContent className="pt-6 text-center">
          <User className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Kandidat Tidak Ditemukan</h2>
          <p className="mb-4 text-gray-500">Kandidat yang Anda cari tidak ada atau sudah dihapus.</p>
          <Link href="/dashboard/hris/candidates">
            <Button>Kembali ke Daftar Kandidat</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const candidateId = params?.id ?? "";

  const detailQuery = useCandidateDetail(candidateId);
  const candidate = detailQuery.data?.candidate ?? null;
  const updateStatusMutation = useUpdateCandidateStatus();
  const moving = updateStatusMutation.isPending;
  const [showEditDialog, setShowEditDialog] = useState(false);

  const { noteEntries, activityEntries } = useMemo(
    () => buildCandidateTimelines(detailQuery.data?.notes ?? [], detailQuery.data?.activities ?? []),
    [detailQuery.data]
  );

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 size-5 animate-spin" /> Memuat data kandidat…
      </div>
    );
  }
  if (!candidate) return <CandidateNotFound />;

  const status = candidate.status as PipelineStage;

  const handleStatusChange = async (newStatus: PipelineStage) => {
    if (candidate.status === newStatus) return;
    try {
      await updateStatusMutation.mutateAsync({ id: candidate.id, status: newStatus });
      toast.success(`Dipindahkan ke ${CANDIDATE_STATUS_LABELS[newStatus] ?? newStatus}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah tahap");
    }
  };

  const handleDownloadCV = () => {
    if (candidate.cv_url) window.open(candidate.cv_url, "_blank");
    else toast.error("CV belum diupload");
  };

  const handleSendWhatsApp = () => {
    const link = buildWaLink(candidate.phone, `Halo ${candidate.full_name}, terima kasih telah melamar di perusahaan kami.`);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };

  const handleSendEmail = () => {
    if (!candidate.email) return;
    window.location.href = `mailto:${candidate.email}?subject=Proses Rekrutmen&body=Halo ${candidate.full_name},`;
  };

  const handlePromoted = () => {
    toast.success("Berhasil dipromosikan menjadi karyawan!");
    detailQuery.refetch();
  };

  return (
    <div className="space-y-5">
      <CandidateDetailHeader
        candidate={candidate}
        status={status}
        moving={moving}
        onMove={handleStatusChange}
        onEdit={() => setShowEditDialog(true)}
        onDownloadCv={handleDownloadCV}
        onWhatsApp={handleSendWhatsApp}
        onEmail={handleSendEmail}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <CandidateStagePanel
            candidate={candidate}
            status={status}
            moving={moving}
            onMove={handleStatusChange}
            onPromoted={handlePromoted}
          />
          <CandidateProfileCard candidate={candidate} />
        </div>

        <div className="space-y-5">
          <CandidateAiSummary candidateId={candidate.id} status={status} />
          <CandidateDocuments
            candidateId={candidate.id}
            cvUrl={candidate.cv_url}
            status={status}
            onDownloadCv={handleDownloadCV}
          />
          <CandidateTimeline candidateId={candidate.id} noteEntries={noteEntries} activityEntries={activityEntries} />
        </div>
      </div>

      {/* Edit dialog: placeholder sampai form edit dibuat */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Data Kandidat</DialogTitle>
            <DialogDescription>Update informasi kandidat {candidate.full_name}.</DialogDescription>
          </DialogHeader>
          <div className="py-8 text-center text-gray-500">
            <Edit3 className="mx-auto mb-4 h-12 w-12 opacity-30" />
            <p>Form edit kandidat akan diimplementasikan selanjutnya</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
