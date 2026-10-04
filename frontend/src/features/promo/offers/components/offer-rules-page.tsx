"use client";

import { useState } from "react";
import { Gift, Loader2, Package, Percent, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { OFFER_TYPE_LABELS } from "@/lib/promo/offer-rules";
import { OFFER_PAGE_META, formatOfferWindow, offerLimitBadges, summarizeOffer } from "../offer-form";
import { useDeleteOfferRule, useOfferRules } from "../queries";
import type { OfferRule, OfferType } from "../types";
import { OfferRuleDialog } from "./offer-rule-dialog";

const TYPE_ICONS = { bundle: Package, bxgy: Gift, volume: Percent } as const;

/** Dialog: tertutup, aturan baru, atau ubah satu aturan. */
type DialogState = { rule: OfferRule | null } | null;

export function OfferRulesPage({ offerType }: { offerType: OfferType }) {
  const meta = OFFER_PAGE_META[offerType];
  const listQuery = useOfferRules(offerType);
  const deleteMutation = useDeleteOfferRule(offerType);
  const [dialog, setDialog] = useState<DialogState>(null);
  const rows = listQuery.data ?? [];

  async function handleDelete(rule: OfferRule) {
    if (!window.confirm(`Hapus aturan “${rule.name}”?`)) return;
    try {
      await deleteMutation.mutateAsync(rule.id);
      toast.success("Aturan dihapus");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">{meta.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">{meta.note}</p>
      </div>

      <PurchasingListSection
        icon={TYPE_ICONS[offerType]}
        title={`Daftar ${OFFER_TYPE_LABELS[offerType]}`}
        description="Berlaku sesuai periode yang ditentukan pada setiap aturan."
        toolbar={
          <Button type="button" onClick={() => setDialog({ rule: null })} className="bg-primary hover:bg-primary/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Tambah
          </Button>
        }
      >
        {listQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Belum ada aturan. Klik Tambah untuk membuat.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="py-3 font-medium">Nama</th>
                  <th className="py-3 font-medium">Aturan</th>
                  <th className="py-3 font-medium">Periode</th>
                  <th className="py-3 font-medium">Batas</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rule) => (
                  <TableRow key={rule.id} className="border-b border-gray-200/70">
                    <td className="py-3 font-medium text-foreground">{rule.name}</td>
                    <td className="py-3 text-muted-foreground">{summarizeOffer(rule)}</td>
                    <td className="py-3 text-muted-foreground">{formatOfferWindow(rule)}</td>
                    <td className="py-3">
                      <OfferLimitBadges rule={rule} />
                    </td>
                    <td className="py-3">
                      <Badge variant={rule.is_active ? "default" : "secondary"}>
                        {rule.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ rule })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          disabled={deleteMutation.isPending}
                          onClick={() => void handleDelete(rule)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {dialog && (
        <OfferRuleDialog
          key={dialog.rule?.id ?? "new"}
          offerType={offerType}
          rule={dialog.rule}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function OfferLimitBadges({ rule }: { rule: OfferRule }) {
  const badges = offerLimitBadges(rule);
  if (badges.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <Badge key={badge.label} variant={badge.variant}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
