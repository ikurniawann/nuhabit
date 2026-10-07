"use client";

import { useState } from "react";
import { BadgeDollarSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRupiah } from "@/lib/format";
import { isOfferOpen } from "@/lib/recruitment/pipeline-stage-rules";
import { useRecordOfferResponse } from "../mutations";
import type { CandidateOffer, OfferResponseStatus, OfferSalaryReference } from "../types";
import { CopyLinkButton, copyPortalLink } from "./stage-panel-parts";

const OFFER_STATUS_META: Record<CandidateOffer["status"], { label: string; badge: string }> = {
  sent: { label: "Menunggu respons", badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300" },
  negotiating: { label: "Negosiasi", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  accepted: { label: "Diterima", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
  declined: { label: "Ditolak", badge: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300" },
  expired: { label: "Kedaluwarsa", badge: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300" },
};

const rupiahOrDash = (value: number | null) => (value ? formatRupiah(value) : "—");

function ReferenceTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Referensi gaji: ekspektasi lamaran, ucapan saat interview AI, budget posisi. */
export function SalaryReferenceCard({ reference }: { reference: OfferSalaryReference }) {
  const said = reference.interview_expectation;
  const budget =
    reference.salary_min || reference.salary_max
      ? `${rupiahOrDash(reference.salary_min)} s/d ${rupiahOrDash(reference.salary_max)}`
      : "belum diatur";
  return (
    <div className="rounded-xl border border-border p-4">
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <BadgeDollarSign className="size-4 text-emerald-500" /> Referensi Gaji
      </h4>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <ReferenceTile label="Ekspektasi di lamaran" value={rupiahOrDash(reference.expected_salary)} />
        <ReferenceTile
          label="Disebut saat interview AI"
          value={said?.disebutkan ? (said.nilai ?? "disebutkan") : "—"}
          note={said?.catatan || undefined}
        />
        <ReferenceTile label="Budget posisi" value={budget} />
      </div>
    </div>
  );
}

/** Form pencatatan respons manual utk offer yang masih terbuka. */
function ManualResponseForm({ offerId, candidateId }: { offerId: string; candidateId: string }) {
  const record = useRecordOfferResponse();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const submit = (status: OfferResponseStatus) => {
    record.mutate(
      { offerId, candidateId, payload: { status, note: note.trim() || null } },
      {
        onSuccess: () => {
          setOpen(false);
          setNote("");
          toast.success("Respons kandidat tercatat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal mencatat respons"),
      }
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        Catat respons manual (kandidat membalas via WA/telepon)
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg bg-muted/50 p-2.5">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Catatan respons kandidat (opsional utk terima/tolak, wajib jelas utk nego)"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={record.isPending} onClick={() => submit("accepted")}>
          Terima
        </Button>
        <Button size="sm" variant="outline" disabled={record.isPending} onClick={() => submit("negotiating")}>
          Nego
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 dark:text-red-400"
          disabled={record.isPending}
          onClick={() => submit("declined")}
        >
          Tolak
        </Button>
        <Button size="sm" variant="ghost" disabled={record.isPending} onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}

/** Satu versi offer: gaji, status, benefit, respons, tautan & respons manual. */
export function OfferCard({ offer, candidateId }: { offer: CandidateOffer; candidateId: string }) {
  const meta = OFFER_STATUS_META[offer.status];
  const open = isOfferOpen(offer);
  const { token } = offer;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          v{offer.version} · {formatRupiah(offer.base_salary)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>{meta.label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {offer.sent_at && formatDate(offer.sent_at)}
          {offer.created_by_name ? ` · ${offer.created_by_name}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {offer.benefits.length > 0 && <span>{offer.benefits.join(" · ")}</span>}
        {offer.start_date && <span>mulai {formatDate(offer.start_date)}</span>}
        {offer.expires_at && open && <span>berlaku s/d {formatDate(offer.expires_at)}</span>}
      </div>
      {offer.response_note && (
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground">
          <span className="font-medium">Respons kandidat</span>
          {offer.response_source === "portal" ? " (via portal)" : " (dicatat manual)"}: {offer.response_note}
        </p>
      )}
      {offer.notes && <p className="text-[11px] italic text-muted-foreground">Catatan internal: {offer.notes}</p>}
      {open && (
        <div className="flex flex-wrap items-center gap-3">
          {token && <CopyLinkButton onClick={() => copyPortalLink(`/offer/${token}`, "Link offer disalin")} />}
          <ManualResponseForm offerId={offer.id} candidateId={candidateId} />
        </div>
      )}
    </div>
  );
}
