"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Calendar, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatReservationQueueNumber } from "@/lib/pos/reservation-queue";
import { useCreateReservation, useUpdateReservationStatus } from "../mutations";
import { printQueueSlip } from "../print-queue-slip";
import { useReservationCustomers, useReservationList, useReservationTables } from "../queries";
import {
  localDateKey,
  queueSlipFields,
  reservationPayload,
  sortByTimeSlot,
  STATUS_FILTERS,
  STATUS_UPDATED_MESSAGE,
  statusFilterLabel,
  summarizeQueue,
  type ReservationForm,
  type StatusFilter,
  type WhatsAppKind,
} from "../reservation-rules";
import type { ReservationRow, ReservationStatus } from "../types";
import { chipClass, NewReservationDialog } from "./new-reservation-dialog";
import { QueueSummaryCards } from "./queue-summary-cards";
import { ReservationCard } from "./reservation-card";
import { WhatsAppDialog } from "./whatsapp-dialog";

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function ReservationPage() {
  const [selectedDate, setSelectedDate] = useState(localDateKey);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState("");
  const [whatsApp, setWhatsApp] = useState<{ reservation: ReservationRow; kind: WhatsAppKind } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const list = useReservationList({ date: selectedDate, status: filterStatus });
  const { data: allForDate = [] } = useReservationList({ date: selectedDate, status: "all" });
  const { data: customers = [], error: customersError } = useReservationCustomers();
  const { data: tables = [], refetch: refetchTables } = useReservationTables();
  const createReservation = useCreateReservation();
  const updateStatusMutation = useUpdateReservationStatus();

  const queueSummary = useMemo(() => summarizeQueue(allForDate), [allForDate]);
  const sortedReservations = useMemo(() => sortByTimeSlot(list.data ?? []), [list.data]);
  const queryError = errorMessage(list.error, "") || errorMessage(customersError, "");

  async function submitReservation(form: ReservationForm) {
    if (!form.customerName.trim() || !form.date || !form.time) {
      toast.error("Name, date, and time are required");
      return;
    }
    setError("");
    try {
      await createReservation.mutateAsync(reservationPayload(form));
      toast.success("Reservation saved");
      setShowNewForm(false);
    } catch (err) {
      const message = errorMessage(err, "Failed to save reservation");
      setError(message);
      toast.error(message);
    }
  }

  async function updateStatus(id: string, status: ReservationStatus) {
    setError("");
    setUpdatingId(id);
    try {
      await updateStatusMutation.mutateAsync({ id, status });
      await refetchTables();
      toast.success(STATUS_UPDATED_MESSAGE[status] || "Reservation updated");
    } catch (err) {
      const message = errorMessage(err, "Failed to update reservation");
      setError(message);
      toast.error(message);
    } finally {
      setUpdatingId(null);
    }
  }

  function printQueue(reservation: ReservationRow) {
    const queueLabel = formatReservationQueueNumber(reservation.queue_number);
    if (!queueLabel) {
      toast.error("Reservasi lama belum bernomor antrian");
      return;
    }
    void printQueueSlip({ queueLabel, ...queueSlipFields(reservation) });
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Reservations</h1>
          <p className="text-xs text-muted-foreground">Manage today&apos;s bookings and seat guests from Restaurant</p>
        </div>
        <Button type="button" onClick={() => setShowNewForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Reservation
        </Button>
      </div>

      {(error || queryError) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error || queryError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Tanggal reservasi"
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          className="h-9 w-auto border-gray-200/80 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStatus(status)}
              className={chipClass(filterStatus === status)}
            >
              {statusFilterLabel(status)}
            </button>
          ))}
        </div>
      </div>

      <QueueSummaryCards summary={queueSummary} />

      <Card className="min-h-0 flex-1 overflow-hidden border-gray-200/70 shadow-xs">
        <CardContent className="flex h-full flex-col p-0">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
            {list.isLoading ? (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reservations…
              </div>
            ) : sortedReservations.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <Calendar className="mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm font-medium text-foreground">No reservations</p>
                <p className="mt-0.5 text-xs">Create one or pick another date.</p>
              </div>
            ) : (
              sortedReservations.map((reservation) => (
                <ReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  busy={updatingId === reservation.id}
                  onStatus={(id, status) => void updateStatus(id, status)}
                  onWhatsApp={(target, kind) => setWhatsApp({ reservation: target, kind })}
                  onPrintQueue={printQueue}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {showNewForm ? (
        <NewReservationDialog
          initialDate={selectedDate}
          customers={customers}
          tables={tables}
          submitting={createReservation.isPending}
          onSubmit={(form) => void submitReservation(form)}
          onClose={() => setShowNewForm(false)}
        />
      ) : null}

      <WhatsAppDialog target={whatsApp} onClose={() => setWhatsApp(null)} />
    </div>
  );
}
