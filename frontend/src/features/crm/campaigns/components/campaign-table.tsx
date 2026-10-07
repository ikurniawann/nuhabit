"use client";

import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCampaignAction, useCampaigns } from "../queries";
import {
  CAMPAIGN_STATUS_BADGES,
  CAMPAIGN_STATUS_LABELS,
  campaignSummary,
  isCancellable,
  primaryCampaignAction,
} from "../campaign-form";

/** Daftar kampanye + aksi mulai/jeda/batal + buka laporan. */
export function CampaignTable({ onCreate, onReport }: { onCreate: () => void; onReport: (id: string) => void }) {
  const campaignsQuery = useCampaigns();
  const actionMutation = useCampaignAction();
  const campaigns = campaignsQuery.data ?? [];

  return (
    <PurchasingListSection
      icon={MegaphoneIcon}
      title="Kampanye"
      description="Draft atau terjadwal → Mulai (bangun antrean) → terkirim → laporan. Kampanye terjadwal dimulai otomatis pada waktunya."
      toolbar={
        <Button size="sm" onClick={onCreate}>
          Buat Kampanye
        </Button>
      }
    >
      {campaignsQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
        </div>
      ) : campaigns.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">Belum ada kampanye.</p>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">Kampanye</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Antrean</th>
                <th className="px-4 py-3 text-right font-semibold">Terkirim</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {campaigns.map((campaign) => {
                const primary = primaryCampaignAction(campaign.status);
                return (
                  <TableRow key={campaign.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{campaign.name}</p>
                      <p className="text-xs text-gray-500">{campaignSummary(campaign)}</p>
                      {campaign.status === "scheduled" && campaign.scheduled_at && (
                        <p className="text-xs text-violet-700">Dikirim {formatDateTime(campaign.scheduled_at)} WIB</p>
                      )}
                      {campaign.status === "failed" && campaign.failure_reason && (
                        <p className="text-xs text-red-600">{campaign.failure_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`border-0 font-normal ${CAMPAIGN_STATUS_BADGES[campaign.status]}`}>
                        {CAMPAIGN_STATUS_LABELS[campaign.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{campaign.pending_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {campaign.sent_count}
                      {Number(campaign.failed_count) > 0 ? (
                        <span className="ml-1 text-xs text-red-500">({campaign.failed_count} gagal)</span>
                      ) : null}
                      {Number(campaign.inapp_count) > 0 && (
                        <span className="block text-xs text-gray-500">{campaign.inapp_count} in-app</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {primary && (
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            disabled={actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ id: campaign.id, action: primary.action })}
                          >
                            {primary.label}
                          </Button>
                        )}
                        {campaign.status === "sending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            disabled={actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ id: campaign.id, action: "pause" })}
                          >
                            Jeda
                          </Button>
                        )}
                        {isCancellable(campaign.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-3 text-red-600"
                            disabled={actionMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Batalkan kampanye "${campaign.name}"? Antrean yang belum terkirim tidak akan dikirim.`
                                )
                              ) {
                                actionMutation.mutate({ id: campaign.id, action: "cancel" });
                              }
                            }}
                          >
                            Batalkan
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => onReport(campaign.id)}>
                          Laporan
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PurchasingListSection>
  );
}
