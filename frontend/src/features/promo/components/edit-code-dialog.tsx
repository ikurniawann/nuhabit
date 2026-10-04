"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateCode } from "../queries";
import type { PromoCode } from "../types";

/** Ubah kode/batas pakai voucher yang belum terpakai. Pasang dengan `key={code.id}`. */
export function EditCodeDialog({ code, onClose }: { code: PromoCode; onClose: () => void }) {
  const [value, setValue] = useState(code.code);
  const [usageLimit, setUsageLimit] = useState(code.usage_limit !== null ? String(code.usage_limit) : "");
  const updateCode = useUpdateCode(onClose);
  const invalid = !/^[A-Za-z0-9-]{3,40}$/.test(value.trim());
  const saving = updateCode.isPending;

  const save = () => {
    if (invalid) return;
    updateCode.mutate({
      id: code.id,
      values: { code: value.trim(), usage_limit: usageLimit.trim() === "" ? null : Number(usageLimit) },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Edit Voucher</DialogPanelTitle>
          <DialogPanelDescription>
            Ubah kode atau batas pemakaian. Hanya untuk voucher yang belum
            terpakai.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit_code">Kode</Label>
            <Input
              id="edit_code"
              value={value}
              disabled={saving}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              className="border-gray-200/80 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_usage_limit">Batas pakai (opsional)</Label>
            <Input
              id="edit_usage_limit"
              type="number"
              min={1}
              placeholder="kosong = tanpa batas / ikut campaign"
              value={usageLimit}
              disabled={saving}
              onChange={(e) => setUsageLimit(e.target.value.replace(/\D/g, ""))}
              className="border-gray-200/80"
            />
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={invalid || saving} onClick={save}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              "Simpan"
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
