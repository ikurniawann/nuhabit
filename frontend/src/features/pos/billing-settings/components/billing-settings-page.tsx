"use client";

import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matchBillingProfile } from "../billing-charges";
import { useBillingOptions } from "../queries";
import { BillingProfileEditor } from "./billing-profile-editor";

export function BillingSettingsPage() {
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const optionsQuery = useBillingOptions(branchId || null);

  const warehouses = useMemo(() => {
    const list = optionsQuery.data?.warehouses ?? [];
    return branchId ? list.filter((row) => row.branch_id === branchId) : list;
  }, [optionsQuery.data?.warehouses, branchId]);

  const matchingProfile = useMemo(
    () => matchBillingProfile(optionsQuery.data?.profiles ?? [], branchId, warehouseId),
    [optionsQuery.data?.profiles, branchId, warehouseId]
  );

  const scopeControls = (
    <>
      <label className="space-y-1.5">
        <span className="text-sm font-medium">Cabang</span>
        <Select
          value={branchId || "system"}
          onValueChange={(value) => {
            setBranchId(value === "system" ? "" : value);
            setWarehouseId("");
          }}
        >
          <SelectTrigger className="h-10 border-gray-200/80">
            <SelectValue placeholder="Default sistem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Default sistem</SelectItem>
            {(optionsQuery.data?.branches ?? []).map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="space-y-1.5">
        <span className="text-sm font-medium">Stall (opsional override)</span>
        <div className={!branchId ? "pointer-events-none opacity-50" : undefined}>
          <Select
            value={warehouseId || "all"}
            onValueChange={(value) => {
              if (!branchId) return;
              setWarehouseId(value === "all" ? "" : value);
            }}
          >
            <SelectTrigger className="h-10 border-gray-200/80">
              <SelectValue placeholder="Semua stall di cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua stall di cabang</SelectItem>
              {warehouses.map((stall) => (
                <SelectItem key={stall.id} value={stall.id}>
                  {stall.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </label>
    </>
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-brand-text">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Tax & Service</h1>
          <p className="text-sm text-muted-foreground">
            Atur PPN dan service charge untuk kasir POS — per sistem, cabang, atau stall.
          </p>
        </div>
      </div>

      <BillingProfileEditor
        key={`${branchId}|${warehouseId}|${matchingProfile?.id ?? ""}`}
        branchId={branchId}
        warehouseId={warehouseId}
        profile={matchingProfile}
        loading={optionsQuery.isLoading}
        scopeControls={scopeControls}
      />
    </div>
  );
}
