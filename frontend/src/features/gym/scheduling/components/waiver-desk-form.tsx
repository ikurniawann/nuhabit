"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Signature } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { schedulingApi } from "../api";

/**
 * Catat waiver di front desk: staf mencentang bahwa member sudah membaca dan
 * menyetujui waiver, lalu server menyimpan versi, waktu, dan akun staf.
 */
export function WaiverDeskForm({ customerId, onRecorded }: { customerId: string; onRecorded: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const record = useMutation({
    mutationFn: () => schedulingApi.recordWaiver(customerId),
    onSuccess: (data) => {
      toast.success("Waiver tercatat", { description: `Versi ${data.version}, dicatat atas nama Anda.` });
      setAgreed(false);
      onRecorded();
    },
    onError: (error) => toast.error("Waiver gagal dicatat", { description: error.message }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 px-3 py-2 sm:flex-row sm:items-center">
      <label className="flex flex-1 items-start gap-2 text-xs">
        <Checkbox className="mt-0.5" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        <span>
          Member sudah membaca dan menyetujui waiver digital di depan staf.
          <span className="block text-muted-foreground">Waktu dan akun Anda ikut tercatat.</span>
        </span>
      </label>
      <Button size="sm" variant="outline" disabled={!agreed || record.isPending} onClick={() => record.mutate()}>
        <Signature /> Catat waiver
      </Button>
    </div>
  );
}
