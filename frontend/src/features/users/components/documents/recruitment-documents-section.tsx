"use client";

import { ArrowDownTrayIcon, DocumentTextIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { EmployeeRecruitmentDocs } from "../../api";
import { DocumentRow } from "./document-row";

/** Dokumen asal rekrutmen: CV dan Laporan Pipeline kandidat. */
export function RecruitmentDocumentsSection({ docs }: { docs: EmployeeRecruitmentDocs | null }) {
  const cvUrl = docs?.cv_url;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold text-gray-700">
        <UserPlusIcon className="w-4 h-4 text-gray-400" /> Dokumen Rekrutmen
      </h3>
      {docs ? (
        <div className="space-y-2">
          {cvUrl ? (
            <DocumentRow
              icon={<DocumentTextIcon className="w-7 h-7 shrink-0 text-red-500" />}
              title="CV / Resume"
              subtitle={
                <>
                  {cvUrl.split(".").pop()?.toUpperCase()}
                  {docs.position_title ? ` · Lamaran: ${docs.position_title}` : ""}
                  {` · ${formatDate(docs.applied_at)}`}
                </>
              }
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(cvUrl, "_blank")}
                  className="gap-1"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Unduh
                </Button>
              }
            />
          ) : (
            <p className="text-sm text-gray-400">CV belum diupload saat rekrutmen.</p>
          )}
          {docs.report_available && (
            <DocumentRow
              icon={<DocumentTextIcon className="w-7 h-7 shrink-0 text-sky-600" />}
              title="Laporan Pipeline"
              subtitle="PDF · seluruh tahapan rekrutmen yang dilalui kandidat"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(`/api/candidates/${docs.candidate_id}/report`, "_blank")
                  }
                  className="gap-1"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Unduh
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          Karyawan ini tidak berasal dari modul rekrutmen — tidak ada CV/laporan pipeline.
        </p>
      )}
    </div>
  );
}
