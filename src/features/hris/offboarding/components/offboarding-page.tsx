"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, User, Calendar, Briefcase, AlertCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useOffboardingEmployee, useOffboardingRecord } from "../queries";
import { useInitiateOffboarding, useUpdateOffboarding } from "../mutations";

interface OffboardingPageProps {
  params: Promise<{ employee_id: string }>;
}

export function OffboardingPage({ params }: OffboardingPageProps) {
  const [resolvedParams] = useState(params);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [showInitiateDialog, setShowInitiateDialog] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  // Form state for initiating offboarding
  const [resignationType, setResignationType] = useState("voluntary");
  const [resignationDate, setResignationDate] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    resolvedParams.then(({ employee_id }) => setEmployeeId(employee_id));
  }, [resolvedParams]);

  const employeeQuery = useOffboardingEmployee(employeeId);
  const recordQuery = useOffboardingRecord(employeeId);
  const employee = employeeQuery.data ?? null;
  const offboarding = recordQuery.data ?? null;
  const isLoading = !employeeId || employeeQuery.isLoading || recordQuery.isLoading;

  const initiateMutation = useInitiateOffboarding(employeeId);
  const updateMutation = useUpdateOffboarding(employeeId);
  const isUpdating = initiateMutation.isPending || updateMutation.isPending;

  const handleInitiateOffboarding = async () => {
    try {
      await initiateMutation.mutateAsync({
        resignation_type: resignationType,
        resignation_date: resignationDate,
        last_working_day: lastWorkingDay,
        reason: reason || null,
      });

      toast({
        title: "✅ Offboarding Dimulai",
        description: "Proses resignasi telah dimulai",
      });

      setShowInitiateDialog(false);

      // Reset form
      setResignationType("voluntary");
      setResignationDate("");
      setLastWorkingDay("");
      setReason("");
    } catch (error) {
      console.error("Initiate error:", error);
      toast({
        title: "Error",
        description: "Gagal memulai proses offboarding.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateClearance = async (clearanceType: string, cleared: boolean, notes?: string) => {
    try {
      await updateMutation.mutateAsync({ clearance_type: clearanceType, cleared, notes });
      toast({
        title: "✅ Clearance Updated",
        description: `${clearanceType.toUpperCase()} clearance: ${cleared ? "Cleared" : "Not cleared"}`,
      });
    } catch (error) {
      console.error("Update clearance error:", error);
      toast({
        title: "Error",
        description: "Gagal update clearance.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateAssets = async (assetName: string, returned: boolean) => {
    try {
      const currentAssets = offboarding?.asset_return_status || {};
      const updatedAssets = { ...currentAssets, [assetName]: returned };
      await updateMutation.mutateAsync({ asset_updates: updatedAssets });
      toast({
        title: "✅ Asset Updated",
        description: `${assetName}: ${returned ? "Returned" : "Not returned"}`,
      });
    } catch (error) {
      console.error("Update asset error:", error);
      toast({
        title: "Error",
        description: "Gagal update asset.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    try {
      await updateMutation.mutateAsync({ status: newStatus });
      toast({
        title: "✅ Status Updated",
        description: `Status: ${newStatus}`,
      });

      if (newStatus === "completed") {
        toast({
          title: "🎉 Offboarding Selesai!",
          description: "Status karyawan otomatis diubah menjadi resigned",
        });
      }
    } catch (error) {
      console.error("Update status error:", error);
      toast({
        title: "Error",
        description: "Gagal update status.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!employee) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-gray-500 mb-4">Karyawan tidak ditemukan</p>
          <Button asChild>
            <Link href="/dashboard/employees">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Kembali ke Daftar Karyawan
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const assets = [
    { key: "laptop", label: "Laptop" },
    { key: "id_card", label: "Kartu ID" },
    { key: "access_card", label: "Kartu Akses" },
    { key: "keys", label: "Kunci" },
    { key: "phone", label: "Handphone Kantor" },
    { key: "other", label: "Lainnya" },
  ];

  const clearances = [
    { key: "hrd", label: "HRD Clearance" },
    { key: "it", label: "IT Clearance" },
    { key: "finance", label: "Finance Clearance" },
    { key: "manager", label: "Manager Clearance" },
  ];

  const statusOptions = [
    { value: "submitted", label: "Submitted" },
    { value: "notice_period", label: "Notice Period" },
    { value: "exit_interview", label: "Exit Interview" },
    { value: "completed", label: "Completed" },
  ];

  const resignationTypeLabels: Record<string, string> = {
    voluntary: "Mengundurkan Diri",
    termination: "PHK",
    layoff: "Layoff",
    end_of_contract: "Akhir Kontrak",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/employees">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offboarding / Resignasi</h1>
          <p className="text-gray-500 mt-1">Kelola proses resignasi dan pengembalian aset</p>
        </div>
      </div>

      {/* Employee Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <User className="w-6 h-6 text-green-600" />
            {employee.full_name}
            <span className="text-sm text-gray-500 font-normal ml-2">{employee.nip} • {employee.department?.name || "-"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Jabatan</p>
              <p className="font-medium">{employee.job_title?.title || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Email</p>
              <p className="font-medium">{employee.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <Badge variant={employee.is_active ? "default" : "secondary"}>
                {employee.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-gray-500">Employment</p>
              <Badge variant="outline">{employee.employment_status}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {!offboarding ? (
        /* No Offboarding Yet - Show Initiate Button */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600" />
              Belum Ada Proses Offboarding
              <span className="text-sm text-gray-500 font-normal ml-2">Mulai proses resignasi untuk karyawan ini</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dialog open={showInitiateDialog} onOpenChange={setShowInitiateDialog}>
              <DialogTrigger>
                <Button className="bg-red-600 hover:bg-red-700">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Mulai Proses Offboarding
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mulai Offboarding</DialogTitle>
                  <DialogDescription>
                    Isi informasi resignasi untuk {employee.full_name}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div>
                    <Label>Jenis Resignasi</Label>
                    <Select value={resignationType} onValueChange={setResignationType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(resignationTypeLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Tanggal Resignasi</Label>
                    <Input
                      type="date"
                      value={resignationDate}
                      onChange={(e) => setResignationDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label>Last Working Day</Label>
                    <Input
                      type="date"
                      value={lastWorkingDay}
                      onChange={(e) => setLastWorkingDay(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label>Alasan (Opsional)</Label>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Jelaskan alasan resignasi..."
                      rows={3}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowInitiateDialog(false)}>
                    Batal
                  </Button>
                  <Button
                    onClick={handleInitiateOffboarding}
                    disabled={isUpdating || !resignationDate || !lastWorkingDay}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4 mr-2" />}
                    Mulai Proses
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        /* Offboarding Exists - Show Full Checklist */
        <>
          {/* Status & Type */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Detail Offboarding</CardTitle>
                  <span className="text-sm text-gray-500">Diproses sejak {new Date(offboarding.created_at).toLocaleDateString("id-ID")}</span>
                </div>
                <Badge variant="outline" className="text-sm">
                  {resignationTypeLabels[offboarding.resignation_type] || offboarding.resignation_type}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Resignation Date</p>
                  <p className="font-medium">{new Date(offboarding.resignation_date).toLocaleDateString("id-ID")}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Last Working Day</p>
                  <p className="font-medium">{new Date(offboarding.last_working_day).toLocaleDateString("id-ID")}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <Select value={offboarding.status} onValueChange={handleUpdateStatus}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
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

              {/* Asset Return */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Briefcase className="w-5 h-5" />
                  Pengembalian Aset
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {assets.map((asset) => {
                    const isReturned = offboarding.asset_return_status?.[asset.key] || false;
                    return (
                      <div
                        key={asset.key}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          isReturned ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                        }`}
                      >
                        <span className="text-sm font-medium">{asset.label}</span>
                        <div className="flex items-center gap-2">
                          {isReturned ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600" />
                          )}
                          <Checkbox
                            checked={isReturned}
                            onCheckedChange={(checked) =>
                              handleUpdateAssets(asset.key, checked as boolean)
                            }
                            disabled={isUpdating}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Clearances */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Department Clearances
                </h3>
                <div className="space-y-3">
                  {clearances.map((clearance) => {
                    const clearanceKey = `clearance_${clearance.key}` as keyof typeof offboarding;
                    const isCleared = offboarding[clearanceKey] as boolean;

                    return (
                      <div
                        key={clearance.key}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          isCleared ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {isCleared ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600" />
                          )}
                          <span className="font-medium">{clearance.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={isCleared ? "cleared" : "not_cleared"}
                            onValueChange={(val) =>
                              handleUpdateClearance(clearance.key, val === "cleared")
                            }
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cleared">Cleared</SelectItem>
                              <SelectItem value="not_cleared">Not Cleared</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Exit Interview & Payroll */}
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
                        onChange={(e) => handleUpdateStatus("exit_interview")}
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
                        onChange={(e) => {
                          // TODO: Implement update
                        }}
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
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Jumlah (Rp)</Label>
                      <Input
                        type="number"
                        value={offboarding.final_payroll_amount || ""}
                        placeholder="0"
                        disabled={isUpdating}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Complete Button */}
              {offboarding.status !== "completed" && (
                <div className="mt-6 pt-6 border-t">
                  <Button
                    onClick={() => handleUpdateStatus("completed")}
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
        </>
      )}
    </div>
  );
}
