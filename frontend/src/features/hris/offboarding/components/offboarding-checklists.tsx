"use client";

import { Briefcase, CheckCircle2, XCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OFFBOARDING_ASSETS,
  OFFBOARDING_CLEARANCES,
  isCleared,
  type ClearanceKey,
} from "@/lib/hris/offboarding-view";
import type { OffboardingRecord } from "../types";

const rowClass = (done: boolean) =>
  `flex items-center justify-between p-3 rounded-lg border ${
    done ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
  }`;

function DoneIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="w-5 h-5 text-green-600" />
  ) : (
    <XCircle className="w-5 h-5 text-red-600" />
  );
}

interface AssetReturnListProps {
  status: OffboardingRecord["asset_return_status"];
  disabled: boolean;
  onChange: (asset: string, returned: boolean) => void;
}

export function AssetReturnList({ status, disabled, onChange }: AssetReturnListProps) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Briefcase className="w-5 h-5" />
        Pengembalian Aset
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {OFFBOARDING_ASSETS.map((asset) => {
          const isReturned = status?.[asset.key] || false;
          return (
            <div key={asset.key} className={rowClass(isReturned)}>
              <span className="text-sm font-medium">{asset.label}</span>
              <div className="flex items-center gap-2">
                <DoneIcon done={isReturned} />
                <Checkbox
                  checked={isReturned}
                  onCheckedChange={(checked) => onChange(asset.key, checked)}
                  disabled={disabled}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ClearanceListProps {
  record: OffboardingRecord;
  onChange: (key: ClearanceKey, cleared: boolean) => void;
}

export function ClearanceList({ record, onChange }: ClearanceListProps) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5" />
        Department Clearances
      </h3>
      <div className="space-y-3">
        {OFFBOARDING_CLEARANCES.map((clearance) => {
          const cleared = isCleared(record, clearance.key);
          return (
            <div key={clearance.key} className={rowClass(cleared)}>
              <div className="flex items-center gap-3">
                <DoneIcon done={cleared} />
                <span className="font-medium">{clearance.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={cleared ? "cleared" : "not_cleared"}
                  onValueChange={(val) => onChange(clearance.key, val === "cleared")}
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
  );
}
