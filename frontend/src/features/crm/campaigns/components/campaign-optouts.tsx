"use client";

import { useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useAddOptout, useOptouts, useRemoveOptout } from "../queries";

/** Nomor opt-out marketing: tidak pernah masuk antrean kampanye. */
export function CampaignOptouts() {
  const optouts = useOptouts().data ?? [];
  const [phone, setPhone] = useState("");
  const addMutation = useAddOptout(() => setPhone(""));
  const removeMutation = useRemoveOptout();

  return (
    <PurchasingListSection
      icon={MegaphoneIcon}
      title="Opt-out Marketing"
      description="Nomor di daftar ini TIDAK pernah masuk antrean kampanye. Terpisah dari consent portal."
    >
      <div className="space-y-3 px-5 py-4">
        <div className="flex gap-2">
          <Input placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs" />
          <Button
            size="sm"
            disabled={addMutation.isPending || phone.replace(/\D/g, "").length < 8}
            onClick={() => addMutation.mutate({ phone })}
          >
            Tambah
          </Button>
        </div>
        {optouts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
            Belum ada nomor opt-out
          </p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {optouts.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
              >
                <span className="font-mono text-gray-900">{row.phone}</span>
                <div className="flex items-center gap-2">
                  <Badge className="border-0 bg-gray-100 font-normal text-gray-600">{row.source}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Hapus opt-out ${row.phone}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(row.id)}
                  >
                    <Trash2 className="h-4 w-4 text-gray-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PurchasingListSection>
  );
}
