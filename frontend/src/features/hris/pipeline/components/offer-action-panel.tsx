"use client";

import { useState } from "react";
import { Handshake, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isOfferOpen, offerChecklist } from "@/lib/recruitment/pipeline-stage-rules";
import { OFFER_REJECTION_WA_TEMPLATE } from "@/lib/recruitment/pipeline-wa-templates";
import { useCandidateOffers } from "../queries";
import { OfferSendDialog } from "./offer-send-dialog";
import { OfferCard, SalaryReferenceCard } from "./offer-history";
import {
  DecisionCard,
  PanelError,
  PanelLoading,
  StepChecklistCard,
  positionTitleOf,
  useSendWaTemplate,
  type StagePanelProps,
} from "./stage-panel-parts";

/**
 * Action panel tahap Offer (EPIC-004): referensi gaji, buat/revisi offer
 * (link portal + WA) & riwayat versi + respons kandidat, keputusan
 * (Diterima → Hired digate offer accepted).
 */
export function OfferActionPanel({ candidate, onMove, moving = false }: StagePanelProps) {
  const offersQuery = useCandidateOffers(candidate.id);
  const [sendOpen, setSendOpen] = useState(false);

  const offers = offersQuery.data?.offers ?? [];
  const reference = offersQuery.data?.salary_reference ?? null;
  const positionTitle = positionTitleOf(candidate, reference?.position_title);
  const wa = useSendWaTemplate(candidate, positionTitle);
  const accepted = offers.some((o) => o.status === "accepted");

  if (offersQuery.isLoading) return <PanelLoading />;
  if (offersQuery.isError) {
    return (
      <PanelError error={offersQuery.error} fallback="Gagal memuat data offer" onRetry={() => offersQuery.refetch()} />
    );
  }

  return (
    <div className="space-y-4">
      <StepChecklistCard
        icon={<Handshake className="size-4 text-emerald-500" />}
        title="Offering"
        items={offerChecklist(offers)}
      />

      {reference && <SalaryReferenceCard reference={reference} />}

      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Penawaran</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> {offers.length > 0 ? "Revisi offer" : "Buat offer"}
          </Button>
        </div>

        {offers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Belum ada penawaran. Buat offer — kandidat merespons lewat link portal.
          </p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} candidateId={candidate.id} />
            ))}
          </div>
        )}
      </div>

      <DecisionCard
        onMove={onMove}
        moving={moving}
        next={{
          stage: "hired",
          label: "Diterima → Hired",
          enabled: accepted,
          lockedHint: 'Tombol "Diterima → Hired" aktif setelah kandidat menerima offer.',
        }}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={!candidate.phone || wa.isPending}
          onClick={() => wa.send(OFFER_REJECTION_WA_TEMPLATE)}
        >
          <MessageCircle className="size-3.5 text-emerald-500" /> WA Penolakan Halus
        </Button>
      </DecisionCard>

      {sendOpen && reference && (
        <OfferSendDialog
          candidate={candidate}
          positionTitle={positionTitle}
          salaryReference={reference}
          hasOpenOffer={offers.some(isOfferOpen)}
          open
          onOpenChange={setSendOpen}
        />
      )}
    </div>
  );
}
