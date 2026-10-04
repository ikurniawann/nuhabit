"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { formatCampaignDiscount, formatCampaignWindow } from "../campaign-form";
import { useUpdateCampaign } from "../queries";
import { PROMO_ELIGIBILITY_LABELS, PROMO_SCOPE_LABELS, type PromoCampaign } from "../types";

/** Tabel campaign: diskon, kanal, periode, pemakaian, saklar aktif & portal member. */
export function CampaignTable({ campaigns, onEdit, onDetail }: {
  campaigns: PromoCampaign[];
  onEdit: (campaign: PromoCampaign) => void;
  onDetail: (campaign: PromoCampaign) => void;
}) {
  const updateMutation = useUpdateCampaign();
  const toggle = (id: string, values: { is_active?: boolean; show_in_member_portal?: boolean }) =>
    updateMutation.mutate({ id, values });

  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full text-sm">
        <thead>
          <TableRow className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground hover:bg-muted/40">
            <th className="px-4 py-3 text-left font-semibold">Campaign</th>
            <th className="px-4 py-3 text-left font-semibold">Diskon</th>
            <th className="px-4 py-3 text-left font-semibold">Kanal</th>
            <th className="px-4 py-3 text-left font-semibold">Periode</th>
            <th className="px-4 py-3 text-right font-semibold">Terpakai</th>
            <th className="px-4 py-3 text-left font-semibold">Aktif</th>
            <th className="px-4 py-3 text-left font-semibold">Portal member</th>
            <th className="px-4 py-3 text-right font-semibold">Aksi</th>
          </TableRow>
        </thead>
        <tbody className="divide-y divide-gray-200/50">
          {campaigns.map((campaign) => (
            <TableRow key={campaign.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <p className="font-medium text-foreground">{campaign.name}</p>
                <p className="text-xs text-muted-foreground">
                  {campaign.codes_count} kode
                  {Number(campaign.min_purchase) > 0 ? ` · min ${formatRupiah(campaign.min_purchase)}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {campaign.target_product_ids.length + campaign.target_category_ids.length > 0 ? (
                    <Badge variant="info">Produk tertentu</Badge>
                  ) : null}
                  {campaign.eligibility !== "semua" ? (
                    <Badge variant="accent">{PROMO_ELIGIBILITY_LABELS[campaign.eligibility]}</Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 font-medium text-foreground">{formatCampaignDiscount(campaign)}</td>
              <td className="px-4 py-3">
                <Badge className="border-0 bg-primary/10 font-normal text-brand-text">
                  {PROMO_SCOPE_LABELS[campaign.scope]}
                </Badge>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{formatCampaignWindow(campaign)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                <p className="font-medium text-foreground">
                  {campaign.captured_count}
                  {campaign.usage_limit !== null ? `/${campaign.usage_limit}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Number(campaign.held_count) > 0 ? `${campaign.held_count} menunggu · ` : ""}
                  {formatRupiah(campaign.discount_captured)}
                </p>
              </td>
              <td className="px-4 py-3">
                <Switch
                  checked={campaign.is_active}
                  disabled={updateMutation.isPending}
                  onCheckedChange={(checked) => toggle(campaign.id, { is_active: checked })}
                />
              </td>
              <td className="px-4 py-3">
                <Switch
                  checked={campaign.show_in_member_portal}
                  disabled={updateMutation.isPending}
                  aria-label={`Tampilkan ${campaign.name} di portal member`}
                  onCheckedChange={(checked) => toggle(campaign.id, { show_in_member_portal: checked })}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {Number(campaign.captured_count) === 0 && (
                    <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => onEdit(campaign)}>
                      Edit
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => onDetail(campaign)}>
                    Kode & Riwayat
                  </Button>
                </div>
              </td>
            </TableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
