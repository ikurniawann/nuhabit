"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { EmployeeContractRow } from "../../api";
import { contractActionMessage } from "@/lib/hris/employee-profile-contracts";
import { useContractAction } from "../../mutations";
import { errorMessage } from "./contract-labels";

interface ContractTerminateDialogProps {
  employeeId: string;
  contract: EmployeeContractRow;
  onClose: () => void;
}

/** Putus kontrak aktif; alasan wajib. */
export function ContractTerminateDialog({
  employeeId,
  contract,
  onClose,
}: ContractTerminateDialogProps) {
  const actionMutation = useContractAction(employeeId);
  const [reason, setReason] = useState("");

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Alasan pemutusan kontrak wajib diisi");
      return;
    }
    try {
      const res = await actionMutation.mutateAsync({
        contractId: contract.id,
        action: "terminate",
        reason: trimmed,
      });
      toast.success(contractActionMessage(res));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Aksi gagal"));
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Putus kontrak ${contract.contract_number}?`}
      confirmLabel="Putus"
      loading={actionMutation.isPending}
      onConfirm={handleConfirm}
    >
      <label className="mb-1 block text-xs font-medium text-gray-600">
        Alasan pemutusan kontrak:
      </label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
    </ConfirmDialog>
  );
}
