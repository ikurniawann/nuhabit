"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import {
  OFFBOARDING_STATUS_OPTIONS,
  resignationTypeLabel,
  withAssetReturn,
  type ClearanceKey,
} from "@/lib/hris/offboarding-view";
import { useUpdateOffboarding } from "../mutations";
import type { OffboardingRecord, UpdateOffboardingPayload } from "../types";
import { AssetReturnList, ClearanceList } from "./offboarding-checklists";

interface OffboardingDetailCardProps {
  employeeId: string;
  offboarding: OffboardingRecord;
}

export function OffboardingDetailCard({ employeeId, offboarding }: OffboardingDetailCardProps) {
  const update = useUpdateOffboarding(employeeId);
  const isUpdating = update.isPending;

  // Kirim perubahan; toast sukses dari caller, toast gagal seragam.
  const save = async (payload: UpdateOffboardingPayload, failMessage: string) => {
    try {
      await update.mutateAsync(payload);
      return true;
    } catch (error) {
      console.error(failMessage, error);
      toast.error("Error", { description: failMessage });
      return false;
    }
  };

  const handleClearance = async (key: ClearanceKey, cleared: boolean) => {
    if (await save({ clearance_type: key, cleared }, "Gagal update clearance.")) {
      toast.success("✅ Clearance Updated", {
        description: `${key.toUpperCase()} clearance: ${cleared ? "Cleared" : "Not cleared"}`,
      });
    }
  };

  const handleAsset = async (asset: string, returned: boolean) => {
    const assetUpdates = withAssetReturn(offboarding.asset_return_status, asset, returned);
    if (await save({ asset_updates: assetUpdates }, "Gagal update asset.")) {
      toast.success("✅ Asset Updated", {
        description: `${asset}: ${returned ? "Returned" : "Not returned"}`,
      });
    }
  };

  const handleStatus = async (status: string) => {
    if (!(await save({ status }, "Gagal update status."))) return;
    toast.success("✅ Status Updated", { description: `Status: ${status}` });
    if (status === "completed") {
      toast.success("🎉 Offboarding Selesai!", {
        description: "Status karyawan otomatis diubah menjadi resigned",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Detail Offboarding</CardTitle>
            <span className="text-sm text-gray-500">Diproses sejak {formatDate(offboarding.created_at)}</span>
          </div>
          <Badge variant="outline" className="text-sm">
            {resignationTypeLabel(offboarding.resignation_type)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <p className="text-sm text-gray-500">Resignation Date</p>
            <p className="font-medium">{formatDate(offboarding.resignation_date)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Last Working Day</p>
            <p className="font-medium">{formatDate(offboarding.last_working_day)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <Select value={offboarding.status} onValueChange={handleStatus}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFBOARDING_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {offboarding.reason && (
          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-1">Alasan:</p>
            <p className="text-sm text-gray-600">{offboarding.reason}</p>
          </div>
        )}

        <AssetReturnList
          status={offboarding.asset_return_status}
          disabled={isUpdating}
          onChange={handleAsset}
        />
        <ClearanceList record={offboarding} onChange={handleClearance} />

        {/* Exit interview & final payroll: belum bisa diedit dari halaman ini */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exit Interview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-sm">Tanggal</Label>
                <Input
                  type="date"
                  value={offboarding.exit_interview_date || ""}
                  onChange={() => handleStatus("exit_interview")}
                  disabled={isUpdating}
                />
              </div>
              <div>
                <Label className="text-sm">Notes</Label>
                <Textarea
                  value={offboarding.exit_interview_notes || ""}
                  placeholder="Catatan exit interview..."
                  rows={3}
                  disabled={isUpdating}
                  readOnly
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Final Payroll</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-sm">Tanggal Pembayaran</Label>
                <Input
                  type="date"
                  value={offboarding.final_payroll_date || ""}
                  disabled={isUpdating}
                  readOnly
                />
              </div>
              <div>
                <Label className="text-sm">Jumlah (Rp)</Label>
                <Input
                  type="number"
                  value={offboarding.final_payroll_amount || ""}
                  placeholder="0"
                  disabled={isUpdating}
                  readOnly
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {offboarding.status !== "completed" && (
          <div className="mt-6 pt-6 border-t">
            <Button
              onClick={() => handleStatus("completed")}
              disabled={isUpdating}
              className="w-full bg-green-600 hover:bg-green-700"
              size="lg"
            >
              {isUpdating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  Selesaikan Offboarding
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              ⚠️ Setelah diselesaikan, status karyawan akan otomatis berubah menjadi &quot;resigned&quot;
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
