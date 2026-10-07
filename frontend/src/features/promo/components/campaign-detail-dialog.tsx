"use client";

// EPIC-032 A3 — dialog detail campaign: daftar kode (+tambah, generate,
// edit/hapus jika belum terpakai, export CSV) + riwayat pemakaian.

import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { codesCsv } from "../campaign-form";
import {
  useDeleteCode,
  useGenerateBatch,
  usePromoCodes,
  usePromoRedemptions,
  useToggleCode,
} from "../queries";
import type { PromoCampaign, PromoCode } from "../types";
import { PROMO_SCOPE_PREFIX } from "../types";
import { EditCodeDialog } from "./edit-code-dialog";

const STATUS_BADGES: Record<string, string> = {
  held: "bg-amber-100 text-amber-700",
  captured: "bg-emerald-100 text-emerald-700",
  released: "bg-gray-100 text-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  held: "Menunggu bayar",
  captured: "Terpakai",
  released: "Dilepas",
};

function downloadCodesCsv(campaignName: string, codes: PromoCode[]) {
  const blob = new Blob([codesCsv(codes)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `voucher-${campaignName.replace(/\s+/g, "-").toLowerCase()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface CampaignDetailDialogProps {
  campaign: PromoCampaign | null;
  onOpenChange: (open: boolean) => void;
}

export function CampaignDetailDialog({
  campaign,
  onOpenChange,
}: CampaignDetailDialogProps) {
  const campaignId = campaign?.id ?? null;
  const codesQuery = usePromoCodes(campaignId);
  const redemptionsQuery = usePromoRedemptions(campaignId);
  const toggleMutation = useToggleCode();
  const deleteMutation = useDeleteCode();

  const [batchCount, setBatchCount] = useState("");
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null);

  const generateBatch = useGenerateBatch(() => {
    setBatchCount("");
  });

  const codes = codesQuery.data ?? [];
  const redemptions = redemptionsQuery.data ?? [];
  const batchCountNum = Number(batchCount);
  const scopePrefix = campaign
    ? PROMO_SCOPE_PREFIX[campaign.scope]
    : PROMO_SCOPE_PREFIX.pos;
  const batchInvalid =
    Number.isNaN(batchCountNum) ||
    batchCountNum < 1 ||
    batchCountNum > 1000;

  const codeBusy = deleteMutation.isPending || toggleMutation.isPending;

  return (
    <>
      <Dialog open={campaign !== null} onOpenChange={onOpenChange}>
        <DialogPanel size="lg" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogPanelHeader>
            <DialogPanelTitle>Kode & Riwayat — {campaign?.name}</DialogPanelTitle>
            <DialogPanelDescription>
              Edit atau hapus voucher hanya jika belum pernah terpakai.
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody className="space-y-5">
            <div className="space-y-1.5 rounded-xl border border-gray-200/70 p-3">
              <Label>Generate Batch Voucher (sekali pakai)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="Jumlah"
                  value={batchCount}
                  onChange={(e) =>
                    setBatchCount(e.target.value.replace(/\D/g, ""))
                  }
                  className="border-gray-200/80"
                />
                <Button
                  size="sm"
                  disabled={batchInvalid || generateBatch.isPending || !campaignId}
                  onClick={() =>
                    campaignId &&
                    generateBatch.mutate({
                      campaignId,
                      prefix: scopePrefix,
                      count: batchCountNum,
                    })
                  }
                >
                  {generateBatch.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Generate"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Prefix otomatis: {scopePrefix} → {scopePrefix}-XXXXXX. Maks
                1000/batch.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Kode ({codes.length})</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={codes.length === 0 || !campaign}
                  onClick={() => campaign && downloadCodesCsv(campaign.name, codes)}
                >
                  Export CSV
                </Button>
              </div>
              {codesQuery.isLoading ? (
                <div className="py-6 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-text" />
                </div>
              ) : codes.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-muted-foreground">
                  Belum ada kode di campaign ini
                </p>
              ) : (
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {codes.map((code) => {
                    const unused = Number(code.usage_count) === 0;
                    return (
                      <div
                        key={code.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-foreground">
                            {code.code}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            terpakai {code.usage_count}
                            {code.usage_limit !== null ? `/${code.usage_limit}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {unused && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0"
                                disabled={codeBusy}
                                onClick={() => setEditingCode(code)}
                                aria-label="Edit kode"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 border-red-200/80 text-red-600 hover:bg-red-50 hover:text-red-700"
                                disabled={codeBusy}
                                onClick={() => deleteMutation.mutate({ id: code.id })}
                                aria-label="Hapus kode"
                              >
                                {deleteMutation.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </>
                          )}
                          <Switch
                            checked={code.is_active}
                            disabled={codeBusy}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({
                                id: code.id,
                                isActive: checked,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <Label>Riwayat Pemakaian (100 terbaru)</Label>
              {redemptionsQuery.isLoading ? (
                <div className="py-6 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-text" />
                </div>
              ) : redemptions.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-muted-foreground">
                  Belum ada pemakaian
                </p>
              ) : (
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {redemptions.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-foreground">
                          {r.code}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.phone ?? "tanpa nomor"} · {formatDateTime(r.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium tabular-nums text-foreground">
                          −{formatRupiah(r.discount_amount)}
                        </p>
                        <Badge
                          className={`border-0 font-normal ${STATUS_BADGES[r.status]}`}
                        >
                          {STATUS_LABELS[r.status]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>

      {editingCode && (
        <EditCodeDialog key={editingCode.id} code={editingCode} onClose={() => setEditingCode(null)} />
      )}
    </>
  );
}
