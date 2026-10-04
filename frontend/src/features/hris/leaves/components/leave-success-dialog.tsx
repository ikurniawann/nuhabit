"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { LEAVE_TYPE_LABELS } from "@/types/hris";
import type { LeaveItem } from "../types";

export type LeaveSubmission = LeaveItem & { employee_name?: string };

export function LeaveSuccessDialog({
  submission,
  onClose,
}: {
  submission: LeaveSubmission;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="text-center mb-4">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Pengajuan Berhasil!</h2>
        </div>

        <div className="space-y-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Karyawan</span>
              <span className="font-medium">{submission.employee_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Jenis Cuti</span>
              <span className="font-medium">
                {LEAVE_TYPE_LABELS[submission.leave_type as keyof typeof LEAVE_TYPE_LABELS]}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Periode</span>
              <span className="font-medium">
                {formatDate(submission.start_date)} - {formatDate(submission.end_date)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Hari</span>
              <Badge variant="outline" className="bg-green-100 text-green-800">
                {submission.total_days} hari
              </Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Status</span>
              <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                Menunggu Persetujuan
              </Badge>
            </div>
          </div>
          <p className="text-sm text-gray-500 text-center">
            Pengajuan cuti Anda sedang menunggu persetujuan dari atasan.
          </p>
        </div>

        <Button onClick={onClose} className="w-full bg-green-600 hover:bg-green-700">
          Tutup
        </Button>
      </div>
    </div>
  );
}
