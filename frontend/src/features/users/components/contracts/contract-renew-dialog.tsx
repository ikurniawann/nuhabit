"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import type { EmployeeContractRow } from "../../api";
import { useContractAction } from "../../mutations";
import { ContractField, PkwtNotice } from "./contract-field";
import { errorMessage } from "./contract-labels";

interface ContractRenewDialogProps {
  employeeId: string;
  contract: EmployeeContractRow;
  onClose: () => void;
}

export function ContractRenewDialog({ employeeId, contract, onClose }: ContractRenewDialogProps) {
  const actionMutation = useContractAction(employeeId);
  const [endDate, setEndDate] = useState("");

  async function handleRenew() {
    if (!endDate) {
      toast.error("Tanggal berakhir perpanjangan wajib diisi");
      return;
    }
    try {
      const res = await actionMutation.mutateAsync({
        contractId: contract.id,
        action: "renew",
        end_date: endDate,
      });
      toast.success(res.message ?? "Draft perpanjangan dibuat");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal memperpanjang"));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Perpanjang Kontrak PKWT</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Kontrak <span className="font-mono">{contract.contract_number}</span> berakhir{" "}
            {formatDate(contract.end_date)}. Draft perpanjangan akan mulai sehari setelahnya, dalam
            rantai kontrak yang sama.
          </p>
          <ContractField label="Tanggal berakhir perpanjangan">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </ContractField>
          <PkwtNotice>
            Total seluruh PKWT karyawan (termasuk perpanjangan ini) maksimal 5 tahun — sistem
            menolak otomatis bila terlampaui.
          </PkwtNotice>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleRenew} disabled={actionMutation.isPending}>
            {actionMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Buat Draft Perpanjangan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
