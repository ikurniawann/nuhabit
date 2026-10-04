"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RESIGNATION_TYPE_LABELS } from "@/lib/hris/offboarding-view";
import { useInitiateOffboarding } from "../mutations";

const EMPTY_FORM = {
  resignationType: "voluntary",
  resignationDate: "",
  lastWorkingDay: "",
  reason: "",
};

interface InitiateOffboardingCardProps {
  employeeId: string;
  employeeName: string;
}

export function InitiateOffboardingCard({ employeeId, employeeName }: InitiateOffboardingCardProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const initiate = useInitiateOffboarding(employeeId);

  const setField = (field: keyof typeof EMPTY_FORM, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    try {
      await initiate.mutateAsync({
        resignation_type: form.resignationType,
        resignation_date: form.resignationDate,
        last_working_day: form.lastWorkingDay,
        reason: form.reason || null,
      });
      toast.success("✅ Offboarding Dimulai", { description: "Proses resignasi telah dimulai" });
      setOpen(false);
      setForm(EMPTY_FORM);
    } catch (error) {
      console.error("Initiate error:", error);
      toast.error("Error", { description: "Gagal memulai proses offboarding." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-yellow-600" />
          Belum Ada Proses Offboarding
          <span className="text-sm text-gray-500 font-normal ml-2">Mulai proses resignasi untuk karyawan ini</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button className="bg-red-600 hover:bg-red-700" onClick={() => setOpen(true)}>
          <AlertCircle className="w-4 h-4 mr-2" />
          Mulai Proses Offboarding
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mulai Offboarding</DialogTitle>
              <DialogDescription>Isi informasi resignasi untuk {employeeName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label>Jenis Resignasi</Label>
                <Select
                  value={form.resignationType}
                  onValueChange={(value) => setField("resignationType", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RESIGNATION_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Tanggal Resignasi</Label>
                <Input
                  type="date"
                  value={form.resignationDate}
                  onChange={(e) => setField("resignationDate", e.target.value)}
                />
              </div>

              <div>
                <Label>Last Working Day</Label>
                <Input
                  type="date"
                  value={form.lastWorkingDay}
                  onChange={(e) => setField("lastWorkingDay", e.target.value)}
                />
              </div>

              <div>
                <Label>Alasan (Opsional)</Label>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setField("reason", e.target.value)}
                  placeholder="Jelaskan alasan resignasi..."
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={initiate.isPending || !form.resignationDate || !form.lastWorkingDay}
                className="bg-red-600 hover:bg-red-700"
              >
                {initiate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4 mr-2" />}
                Mulai Proses
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
