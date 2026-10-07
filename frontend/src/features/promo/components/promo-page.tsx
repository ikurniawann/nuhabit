"use client";

// EPIC-032 A3 — halaman admin Engine Promosi: daftar campaign + buat/ubah
// campaign (campaign-form-dialog) dan detail kode (campaign-detail-dialog).

import { useState } from "react";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCampaigns } from "../queries";
import type { PromoCampaign } from "../types";
import { CampaignDetailDialog } from "./campaign-detail-dialog";
import { CampaignFormDialog } from "./campaign-form-dialog";
import { CampaignTable } from "./campaign-table";
import { GiftCardPage } from "./gift-card-page";

/** Dialog form: tertutup, campaign baru, atau ubah satu campaign. */
type FormState = { campaign: PromoCampaign | null } | null;

export function PromoPage() {
  const [tab, setTab] = useState<"campaigns" | "gift-cards">("campaigns");
  const campaignsQuery = useCampaigns();
  const campaigns = campaignsQuery.data ?? [];
  const [formState, setFormState] = useState<FormState>(null);
  const [detailCampaign, setDetailCampaign] = useState<PromoCampaign | null>(null);

  const openEdit = (campaign: PromoCampaign) => {
    if (Number(campaign.captured_count) > 0) {
      toast.error("Campaign sudah punya voucher terpakai — tidak bisa diedit");
      return;
    }
    setFormState({ campaign });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Promo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat campaign diskon, keluarkan kode publik atau batch voucher, lalu
          pakai di kasir / tiket.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "campaigns" | "gift-cards")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="campaigns">Campaign & Voucher</TabsTrigger>
          <TabsTrigger value="gift-cards">Gift Card</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4">
          <PurchasingListSection
            icon={TicketIcon}
            title="Campaign Promo"
            description="Satu campaign = satu aturan diskon. Saat simpan bisa langsung generate voucher sesuai jumlah."
            toolbar={
              <Button size="sm" onClick={() => setFormState({ campaign: null })}>
                Buat Campaign
              </Button>
            }
          >
            {campaignsQuery.isLoading ? (
              <div className="py-14 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
                <p className="mt-2 text-sm text-muted-foreground">Memuat campaign...</p>
              </div>
            ) : campaigns.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Belum ada campaign — mulai dari &quot;Buat Campaign&quot;.
              </p>
            ) : (
              <CampaignTable campaigns={campaigns} onEdit={openEdit} onDetail={setDetailCampaign} />
            )}
          </PurchasingListSection>
        </TabsContent>

        <TabsContent value="gift-cards" className="mt-4">
          <GiftCardPage />
        </TabsContent>
      </Tabs>

      {formState && (
        <CampaignFormDialog
          key={formState.campaign?.id ?? "new"}
          campaign={formState.campaign}
          onClose={() => setFormState(null)}
        />
      )}

      <CampaignDetailDialog
        campaign={detailCampaign}
        onOpenChange={(open) => !open && setDetailCampaign(null)}
      />
    </div>
  );
}
