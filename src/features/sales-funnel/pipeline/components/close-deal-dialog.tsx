"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLostReasons } from "../queries";
import type { DealUpdatePayload, SalesDeal, SalesStage } from "../types";

export interface CloseDealTarget {
  deal: SalesDeal;
  stage: SalesStage;
}

export interface CloseDealExtras {
  /** Alur Fase D "Menang → jadikan PIC member loyalty" */
  makeMember: boolean;
  leadId: string;
}

interface CloseDealDialogProps {
  target: CloseDealTarget | null;
  onClose: () => void;
  onSubmit: (
    dealId: string,
    values: DealUpdatePayload,
    extras: CloseDealExtras
  ) => void;
  isPending: boolean;
}

/**
 * Dialog wajib saat deal digeser ke tahap Menang (nilai final + tanggal
 * acara fix) atau Kalah (alasan) — aturan acceptance criteria EPIC-022.
 */
export function CloseDealDialog({ target, onClose, onSubmit, isPending }: CloseDealDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target ? (
          <CloseDealForm
            key={`${target.deal.id}:${target.stage.id}`}
            target={target}
            onClose={onClose}
            onSubmit={onSubmit}
            isPending={isPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CloseDealForm({
  target,
  onClose,
  onSubmit,
  isPending,
}: CloseDealDialogProps & { target: CloseDealTarget }) {
  const [valueFinal, setValueFinal] = useState(target.deal.value_final ?? target.deal.value_estimate ?? "");
  const [eventDate, setEventDate] = useState(target.deal.event_date?.slice(0, 10) ?? "");
  const [lostReasonId, setLostReasonId] = useState("");
  const [makeMember, setMakeMember] = useState(false);

  const lostReasonsQuery = useLostReasons();
  const lostReasons = lostReasonsQuery.data ?? [];

  const isWon = target.stage.is_won;

  const canSubmit = isWon
    ? valueFinal !== "" && Number(valueFinal) >= 0 && eventDate !== ""
    : lostReasonId !== "";

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    const extras: CloseDealExtras = {
      makeMember: isWon && makeMember,
      leadId: target.deal.lead_id,
    };
    if (isWon) {
      onSubmit(
        target.deal.id,
        {
          stage_id: target.stage.id,
          value_final: Number(valueFinal),
          event_date: eventDate,
          is_event_date_fixed: true,
        },
        extras
      );
    } else {
      onSubmit(
        target.deal.id,
        {
          stage_id: target.stage.id,
          lost_reason_id: lostReasonId,
        },
        extras
      );
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isWon ? "Deal Menang (Booked) 🎉" : "Deal Kalah"}
        </DialogTitle>
        <DialogDescription>
          {isWon
            ? `Konfirmasi booking "${target.deal.title}" — ${target.deal.org_name}.`
            : `Catat alasan kalah "${target.deal.title}" — ${target.deal.org_name}.`}
        </DialogDescription>
      </DialogHeader>

      {isWon ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="value_final">Nilai Final (Rp) *</Label>
            <Input
              id="value_final"
              type="number"
              min={0}
              value={valueFinal}
              onChange={(e) => setValueFinal(e.target.value)}
              placeholder="15000000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="event_date_won">Tanggal Acara (fix) *</Label>
            <Input
              id="event_date_won"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
            <p className="text-xs text-gray-500">
              Menang = booking terkonfirmasi, tanggal otomatis ditandai fix.
            </p>
          </div>
          {!target.deal.customer_id ? (
            <label className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm text-emerald-900">
              <Checkbox
                checked={makeMember}
                onCheckedChange={(checked) => setMakeMember(checked === true)}
              />
              Jadikan {target.deal.pic_name} member loyalty
            </label>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Alasan Kalah *</Label>
          <Select value={lostReasonId} onValueChange={setLostReasonId}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih alasan..." />
            </SelectTrigger>
            <SelectContent>
              {lostReasons.map((reason) => (
                <SelectItem key={reason.id} value={reason.id}>
                  {reason.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Batal
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className={isWon ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
        >
          {isPending ? "Menyimpan…" : isWon ? "Konfirmasi Booking" : "Tandai Kalah"}
        </Button>
      </DialogFooter>
    </>
  );
}
