"use client";

import { useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useStages } from "../../pipeline/queries";
import { PipelinesSection } from "./pipelines-section";
import type { SalesStage } from "../../pipeline/types";
import { RecipesSection } from "./recipes-section";
import { StageEditForm } from "./stage-edit-form";
import { WaTemplatesSection } from "./wa-templates-section";

export function FunnelSettingsPage() {
  const [editingStage, setEditingStage] = useState<SalesStage | null>(null);
  const stagesQuery = useStages(true);
  const stages = stagesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Funnel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Konfigurasi tahap pipeline: nama, urutan, dan ambang hari deal macet.
        </p>
      </div>

      <PipelinesSection />

      <PurchasingListSection
        icon={Cog6ToothIcon}
        title="Tahap Pipeline"
        description="Tahap Menang/Kalah selalu aktif — nama & ambang tetap bisa diubah."
      >
        {stagesQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat tahap...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Urutan</th>
                  <th className="px-4 py-3 text-left font-semibold">Nama Tahap</th>
                  <th className="px-4 py-3 text-left font-semibold">Tipe</th>
                  <th className="px-4 py-3 text-left font-semibold">Ambang Macet</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {stages.map((stage) => (
                  <TableRow key={stage.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 text-gray-500">{stage.sort_order}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {stage.name}
                      <span className="ml-2 font-mono text-xs text-gray-400">
                        {stage.code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {stage.is_won ? (
                        <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                          Menang
                        </Badge>
                      ) : stage.is_lost ? (
                        <Badge className="border-0 bg-red-100 font-normal text-red-700">
                          Kalah
                        </Badge>
                      ) : (
                        <span className="text-gray-500">Berjalan</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {typeof stage.probability === "number" ? `${stage.probability}% · ` : ""}
                      {stage.stuck_threshold_days > 0
                        ? `> ${stage.stuck_threshold_days} hari`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {stage.is_active ? (
                        <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                          Aktif
                        </Badge>
                      ) : (
                        <Badge className="border-0 bg-gray-100 font-normal text-gray-500">
                          Nonaktif
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingStage(stage)}
                          className="h-8 px-3 text-gray-600 hover:bg-gray-100 hover:text-pink-600"
                        >
                          Edit
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <RecipesSection />

      <WaTemplatesSection />

      <Dialog
        open={editingStage !== null}
        onOpenChange={(open) => !open && setEditingStage(null)}
      >
        <DialogContent className="sm:max-w-md">
          {editingStage ? (
            <StageEditForm key={editingStage.id} stage={editingStage} onClose={() => setEditingStage(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
