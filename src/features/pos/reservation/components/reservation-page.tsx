"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  Search,
  User,
  Users,
  X,
  Printer,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { floorLabel, floorSortKey } from "@/features/pos/tables/floor-options";
import { cn } from "@/lib/utils";

import {
  buildReservationQueueWaMessage,
  formatReservationQueueNumber,
} from "@/lib/pos/reservation-queue";
import { printQueueSlip } from "../print-queue-slip";
import type {
  CreateReservationPayload,
  OrderType,
  ReservationCustomer,
  ReservationRow,
  ReservationStatus,
  ReservationTable,
} from "../types";
import {
  useReservationCustomers,
  useReservationList,
  useReservationTables,
} from "../queries";
import {
  useCreateReservation,
  useUpdateReservationStatus,
} from "../mutations";

const TIME_SLOTS = [
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
];

const TIME_SLOT_OPTIONS = TIME_SLOTS.map((slot) => ({
  value: slot,
  label: slot,
}));

const STATUS_FILTERS = [
  "all",
  "pending",
  "confirmed",
  "seated",
  "completed",
] as const;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

const getToday = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function statusMeta(status: ReservationStatus) {
  switch (status) {
    case "pending":
      return {
        label: "Pending",
        className: "border-amber-200/80 bg-amber-50 text-amber-800",
      };
    case "confirmed":
      return {
        label: "Confirmed",
        className: "border-sky-200/80 bg-sky-50 text-sky-800",
      };
    case "seated":
      return {
        label: "Seated",
        className: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
      };
    case "completed":
      return {
        label: "Completed",
        className: "border-gray-200/80 bg-muted/60 text-muted-foreground",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className: "border-red-200/80 bg-red-50 text-red-700",
      };
    case "no_show":
      return {
        label: "No show",
        className: "border-red-200/80 bg-red-50 text-red-700",
      };
  }
}

function reservationName(row: ReservationRow) {
  return row.customer?.name || row.customer_name || "Guest";
}

function reservationPhone(row: ReservationRow) {
  return row.customer?.phone || row.customer_phone || "—";
}

function tableDisplayName(table: ReservationTable) {
  return table.label || table.table_number || table.name || "Table";
}

function groupTablesByFloor(tables: ReservationTable[]) {
  const map = new Map<string, ReservationTable[]>();
  for (const table of tables) {
    if (table.is_active === false) continue;
    const key = String(table.floor ?? "").trim();
    const list = map.get(key) ?? [];
    list.push(table);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b))
    .map(([floorKey, group]) => ({
      floorKey,
      label: floorLabel(floorKey),
      tables: [...group].sort((a, b) =>
        tableDisplayName(a).localeCompare(tableDisplayName(b), undefined, {
          numeric: true,
        })
      ),
    }));
}

const chipClass = (active: boolean) =>
  cn(
    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-primary/30 bg-primary/10 text-primary"
      : "border-gray-200/80 bg-card text-muted-foreground hover:border-primary/20 hover:bg-primary/5 hover:text-foreground"
  );

const fieldInputClass =
  "h-9 w-full rounded-md border border-gray-200/80 bg-background px-3 text-sm shadow-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/30";

export function ReservationPage() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [filterStatus, setFilterStatus] = useState<ReservationStatus | "all">(
    "all"
  );
  const [error, setError] = useState("");
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false);
  const [whatsAppReservation, setWhatsAppReservation] =
    useState<ReservationRow | null>(null);
  const [whatsAppType, setWhatsAppType] = useState<"reminder" | "confirmation" | "queue">(
    "reminder"
  );
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const {
    data: reservations = [],
    isLoading: loading,
    error: reservationsError,
  } = useReservationList({ date: selectedDate, status: filterStatus });
  const { data: allForDate = [] } = useReservationList({
    date: selectedDate,
    status: "all",
  });

  /* Kartu ringkasan antrian (owner 2026-08-16): sedang dilayani, siapa yang
   * harus siap-siap, dan berapa yang menunggu — dihitung dari SEMUA reservasi
   * tanggal terpilih, bukan subset filter chip. */
  const queueSummary = useMemo(() => {
    const withQueue = allForDate.filter((r) => Number(r.queue_number) > 0);
    const waiting = withQueue
      .filter((r) => r.status === "pending" || r.status === "confirmed")
      .sort((a, b) => Number(a.queue_number) - Number(b.queue_number));
    const served = withQueue
      .filter((r) => r.status === "seated" || r.status === "completed")
      .sort((a, b) => Number(b.queue_number) - Number(a.queue_number));
    return {
      nowServing: served[0] ?? null,
      next: waiting[0] ?? null,
      waitingCount: waiting.length,
    };
  }, [allForDate]);
  const { data: customers = [], error: customersError } =
    useReservationCustomers();
  const { data: tables = [], refetch: refetchTables } = useReservationTables();
  const createReservationMutation = useCreateReservation();
  const updateStatusMutation = useUpdateReservationStatus();

  const queryError =
    (reservationsError instanceof Error ? reservationsError.message : "") ||
    (customersError instanceof Error ? customersError.message : "");
  const submitting = createReservationMutation.isPending;

  const [formData, setFormData] = useState({
    customerId: null as string | null,
    customerName: "",
    customerPhone: "",
    date: getToday(),
    time: "12:00",
    guestCount: 2,
    tableId: null as string | null,
    notes: "",
    deposit: 0,
    orderType: "dine_in" as OrderType,
  });

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) =>
      `${customer.name || ""} ${customer.phone}`.toLowerCase().includes(query)
    );
  }, [customerSearch, customers]);

  const sortedReservations = useMemo(
    () =>
      [...reservations].sort((a, b) =>
        String(a.time_slot || "").localeCompare(String(b.time_slot || ""))
      ),
    [reservations]
  );

  const tableGroups = useMemo(() => groupTablesByFloor(tables), [tables]);

  function selectCustomer(customer: ReservationCustomer) {
    setFormData((prev) => ({
      ...prev,
      customerId: customer.id,
      customerName: customer.name || "",
      customerPhone: customer.phone,
    }));
    setShowCustomerSearch(false);
    setCustomerSearch("");
  }

  function resetForm() {
    setFormData({
      customerId: null,
      customerName: "",
      customerPhone: "",
      date: selectedDate,
      time: "12:00",
      guestCount: 2,
      tableId: null,
      notes: "",
      deposit: 0,
      orderType: "dine_in",
    });
  }

  async function submitReservation() {
    if (!formData.customerName.trim() || !formData.date || !formData.time) {
      toast.error("Name, date, and time are required");
      return;
    }
    setError("");
    try {
      const payload: CreateReservationPayload = {
        table_id: formData.tableId,
        customer_id: formData.customerId,
        customer_name: formData.customerName.trim(),
        customer_phone: formData.customerPhone.trim(),
        reservation_date: formData.date,
        time_slot: formData.time,
        pax_count: formData.guestCount,
        special_requests: formData.orderType,
        deposit_amount: formData.deposit,
        notes: formData.notes,
      };
      await createReservationMutation.mutateAsync(payload);
      toast.success("Reservation saved");
      setShowNewForm(false);
      resetForm();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save reservation";
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
      const labels: Partial<Record<ReservationStatus, string>> = {
        confirmed: "Reservation confirmed",
        seated: "Guest seated",
        completed: "Reservation completed",
        cancelled: "Reservation cancelled",
        no_show: "Marked as no show",
      };
      toast.success(labels[status] || "Reservation updated");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update reservation";
      setError(message);
      toast.error(message);
    } finally {
      setUpdatingId(null);
    }
  }

  function generateWhatsAppMessage(
    reservation: ReservationRow,
    type: "reminder" | "confirmation" | "queue"
  ) {
    if (type === "queue") {
      return buildReservationQueueWaMessage({
        guestName: reservationName(reservation),
        queueLabel:
          formatReservationQueueNumber(reservation.queue_number) ?? "-",
        dateLabel: queueDateLabel(reservation),
        timeLabel: String(reservation.time_slot || "").slice(0, 5),
        paxCount: reservation.pax_count,
        tableLabel: reservation.table?.table_number || null,
        merchantName: "BCD Coffee",
      });
    }
    const dateObj = new Date(`${reservation.reservation_date}T00:00:00`);
    const formattedDate = dateObj.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const intro =
      type === "confirmation"
        ? "Your reservation has been confirmed:"
        : "This is a reminder for your reservation:";
    return `Hello ${reservationName(reservation)}!\n\n${intro}\n\nDate: ${formattedDate}\nTime: ${reservation.time_slot}\nGuests: ${reservation.pax_count}\n${reservation.table?.table_number ? `Table: ${reservation.table.table_number}\n` : ""}${reservation.notes ? `Notes: ${reservation.notes}\n` : ""}\nPlease arrive 10 minutes before your reservation time.\n\nPrologue Wonderland`;
  }

  function queueDateLabel(reservation: ReservationRow) {
    return new Date(`${reservation.reservation_date}T00:00:00`).toLocaleDateString(
      "id-ID",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    );
  }

  function handlePrintQueueSlip(reservation: ReservationRow) {
    const queueLabel = formatReservationQueueNumber(reservation.queue_number);
    if (!queueLabel) {
      toast.error("Reservasi lama belum bernomor antrian");
      return;
    }
    void printQueueSlip({
      queueLabel,
      guestName: reservationName(reservation),
      paxCount: reservation.pax_count,
      dateLabel: queueDateLabel(reservation),
      timeLabel: String(reservation.time_slot || "").slice(0, 5),
      tableLabel: reservation.table?.table_number || null,
    });
  }

  function openWhatsApp(
    reservation: ReservationRow,
    type: "reminder" | "confirmation" | "queue"
  ) {
    setWhatsAppReservation(reservation);
    setWhatsAppType(type);
    setShowWhatsAppDialog(true);
  }

  function sendWhatsApp() {
    if (!whatsAppReservation) return;
    const phone = reservationPhone(whatsAppReservation).replace(/[^0-9]/g, "");
    if (!phone || phone === "") {
      toast.error("No phone number for this guest");
      return;
    }
    const normalizedPhone = phone.startsWith("0")
      ? `62${phone.slice(1)}`
      : phone;
    const message = generateWhatsAppMessage(whatsAppReservation, whatsAppType);
    window.open(
      `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
      "_blank"
    );
    setShowWhatsAppDialog(false);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">
            Reservations
          </h1>
          <p className="text-xs text-muted-foreground">
            Manage today&apos;s bookings and seat guests from Restaurant
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            resetForm();
            setShowNewForm(true);
          }}
        >
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
              {status === "all"
                ? "All"
                : status === "no_show"
                  ? "No show"
                  : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200/70 bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Antrian Sekarang
          </div>
          {queueSummary.nowServing ? (
            <>
              <div className="mt-1 text-2xl font-bold tabular-nums text-primary">
                {formatReservationQueueNumber(queueSummary.nowServing.queue_number)}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {reservationName(queueSummary.nowServing)}
              </div>
            </>
          ) : (
            <div className="mt-1 text-2xl font-bold text-muted-foreground/50">—</div>
          )}
        </div>
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Siap-Siap Berikutnya
          </div>
          {queueSummary.next ? (
            <>
              <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
                {formatReservationQueueNumber(queueSummary.next.queue_number)}
              </div>
              <div className="truncate text-xs font-medium text-amber-800">
                a/n {reservationName(queueSummary.next)} · {queueSummary.next.pax_count} orang
              </div>
            </>
          ) : (
            <div className="mt-1 text-2xl font-bold text-amber-700/40">—</div>
          )}
        </div>
        <div className="rounded-xl border border-gray-200/70 bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total Menunggu
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {queueSummary.waitingCount}
            <span className="ml-1.5 text-sm font-medium text-muted-foreground">antrian</span>
          </div>
        </div>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden border-gray-200/70 shadow-xs">
        <CardContent className="flex h-full flex-col p-0">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reservations…
              </div>
            ) : sortedReservations.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <Calendar className="mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm font-medium text-foreground">
                  No reservations
                </p>
                <p className="mt-0.5 text-xs">
                  Create one or pick another date.
                </p>
              </div>
            ) : (
              sortedReservations.map((reservation) => {
                const badge = statusMeta(reservation.status);
                const busy = updatingId === reservation.id;
                return (
                  <div
                    key={reservation.id}
                    className="rounded-xl border border-gray-200/70 bg-card p-4"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {formatReservationQueueNumber(reservation.queue_number) ? (
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-sm font-bold tabular-nums text-primary">
                              {formatReservationQueueNumber(reservation.queue_number)}
                            </span>
                          ) : null}
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {reservationName(reservation)}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn("font-medium", badge.className)}
                          >
                            {badge.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {reservationPhone(reservation)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {reservation.pax_count} guests
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {String(reservation.time_slot || "").slice(0, 5)}
                        </div>
                        {reservation.table?.table_number ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {reservation.table.table_number}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {reservation.notes ? (
                      <div className="mb-3 rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {reservation.notes}
                      </div>
                    ) : null}
                    {Number(reservation.deposit_amount || 0) > 0 ? (
                      <div className="mb-3 text-xs font-medium text-emerald-700">
                        Deposit: {formatCurrency(Number(reservation.deposit_amount))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 border-t border-gray-200/70 pt-3">
                      {(reservation.status === "pending" ||
                        reservation.status === "confirmed") &&
                      formatReservationQueueNumber(reservation.queue_number) ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-gray-200/80"
                            disabled={busy}
                            title="Cetak slip nomor antrian"
                            onClick={() => handlePrintQueueSlip(reservation)}
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Antrian
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-200/80 text-emerald-700 hover:bg-emerald-50"
                            disabled={busy}
                            title="Kirim nomor antrian via WhatsApp"
                            onClick={() => openWhatsApp(reservation, "queue")}
                          >
                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                            WA Antrian
                          </Button>
                        </>
                      ) : null}
                      {reservation.status === "pending" ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-sky-200/80 text-sky-700 hover:bg-sky-50"
                            disabled={busy}
                            onClick={() =>
                              updateStatus(reservation.id, "confirmed")
                            }
                          >
                            {busy ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Confirm
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-200/80 text-emerald-700 hover:bg-emerald-50"
                            disabled={busy}
                            onClick={() =>
                              openWhatsApp(reservation, "confirmation")
                            }
                          >
                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                            WhatsApp
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-red-200/80 text-red-600 hover:bg-red-50"
                            disabled={busy}
                            onClick={() =>
                              updateStatus(reservation.id, "cancelled")
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      {reservation.status === "confirmed" ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-200/80 text-emerald-700 hover:bg-emerald-50"
                            disabled={busy}
                            onClick={() =>
                              updateStatus(reservation.id, "seated")
                            }
                          >
                            {busy ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Seat
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-200/80 text-emerald-700 hover:bg-emerald-50"
                            disabled={busy}
                            onClick={() =>
                              openWhatsApp(reservation, "reminder")
                            }
                          >
                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                            Reminder
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-gray-200/80 text-muted-foreground"
                            disabled={busy}
                            onClick={() =>
                              updateStatus(reservation.id, "no_show")
                            }
                          >
                            No show
                          </Button>
                        </>
                      ) : null}
                      {reservation.status === "seated" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-gray-200/80"
                          disabled={busy}
                          onClick={() =>
                            updateStatus(reservation.id, "completed")
                          }
                        >
                          {busy ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Complete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={showNewForm}
        onOpenChange={(open) => {
          if (!open) setShowNewForm(false);
        }}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>New Reservation</DialogPanelTitle>
            <DialogPanelDescription>
              Book a table for a guest. Table is optional.
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Customer</Label>
              <button
                type="button"
                onClick={() => setShowCustomerSearch(true)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-gray-200/80 px-3 text-left text-sm hover:border-primary/30 hover:bg-primary/5"
              >
                <span
                  className={
                    formData.customerName
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {formData.customerName || "Find customer…"}
                </span>
                <Search className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={formData.customerName}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      customerName: event.target.value,
                    }))
                  }
                  className={fieldInputClass}
                  placeholder="Guest name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Phone</Label>
                <Input
                  value={formData.customerPhone}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      customerPhone: event.target.value,
                    }))
                  }
                  className={fieldInputClass}
                  placeholder="08…"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      date: event.target.value,
                    }))
                  }
                  className={fieldInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Time</Label>
                <Combobox
                  options={TIME_SLOT_OPTIONS}
                  value={formData.time}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      time: value || prev.time,
                    }))
                  }
                  placeholder="Select time"
                  searchPlaceholder="Search time…"
                  emptyMessage="No time found"
                  className="h-9 border-gray-200/80 focus-visible:border-primary/30 focus-visible:ring-primary/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Guests</Label>
              <Input
                type="number"
                min={1}
                value={formData.guestCount}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    guestCount: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
                className={fieldInputClass}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  Select table
                </Label>
                <button
                  type="button"
                  className={cn(
                    "text-xs font-medium",
                    formData.tableId == null
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, tableId: null }))
                  }
                >
                  Unassigned
                </button>
              </div>
              <div className="max-h-48 space-y-3 overflow-y-auto rounded-lg border border-gray-200/70 bg-muted/20 p-2.5">
                {tableGroups.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">
                    No active tables.
                  </p>
                ) : (
                  tableGroups.map((group) => (
                    <div key={group.floorKey || "__none"} className="space-y-1.5">
                      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                        {group.tables.map((table) => {
                          const active = formData.tableId === table.id;
                          return (
                            <button
                              key={table.id}
                              type="button"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  tableId:
                                    prev.tableId === table.id ? null : table.id,
                                }))
                              }
                              className={cn(
                                "rounded-lg border px-2 py-1.5 text-left transition-colors",
                                active
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-gray-200/80 bg-card text-foreground hover:border-primary/20"
                              )}
                            >
                              <div className="truncate text-xs font-medium">
                                {tableDisplayName(table)}
                              </div>
                              <div className="text-[10px] opacity-70">
                                {table.capacity || 4} pax
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Order type</Label>
              <div className="flex gap-2">
                {(["dine_in", "takeaway", "delivery"] as OrderType[]).map(
                  (type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, orderType: type }))
                      }
                      className={cn(
                        "flex-1",
                        chipClass(formData.orderType === type),
                        "py-2"
                      )}
                    >
                      {type === "dine_in"
                        ? "Dine-in"
                        : type === "takeaway"
                          ? "Takeaway"
                          : "Delivery"}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Deposit</Label>
              <div className="flex flex-wrap gap-2">
                {[0, 25000, 50000, 100000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, deposit: amount }))
                    }
                    className={cn("min-w-18 flex-1", chipClass(formData.deposit === amount), "py-2")}
                  >
                    {amount === 0 ? "None" : formatCurrency(amount)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                placeholder="e.g. Birthday, business meeting…"
                className="min-h-16 resize-none border-gray-200/80 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          </DialogPanelBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowNewForm(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitReservation}
              disabled={
                submitting ||
                !formData.customerName.trim() ||
                !formData.date ||
                !formData.time
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save reservation"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog
        open={showCustomerSearch}
        onOpenChange={(open) => {
          if (!open) setShowCustomerSearch(false);
        }}
      >
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Find customer</DialogPanelTitle>
            <DialogPanelDescription>
              Search by name or phone, or continue as a new guest.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Name or phone…"
                autoFocus
                className="h-9 border-gray-200/80 pl-9 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({
                    ...prev,
                    customerId: null,
                    customerName: "",
                    customerPhone: "",
                  }));
                  setShowCustomerSearch(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-gray-200/70 hover:bg-muted/40"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    New guest
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Enter name and phone on the form
                  </div>
                </div>
              </button>
              {filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => selectCustomer(customer)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-primary/20 hover:bg-primary/5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-sm font-semibold text-primary">
                      {(customer.name || customer.phone).charAt(0)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {customer.name || "Guest"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {customer.phone}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {customer.visit_count || 0}×
                  </div>
                </button>
              ))}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowCustomerSearch(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog
        open={showWhatsAppDialog}
        onOpenChange={(open) => {
          if (!open) setShowWhatsAppDialog(false);
        }}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-600" />
              Send WhatsApp
            </DialogPanelTitle>
            <DialogPanelDescription>
              Preview the message before opening WhatsApp.
            </DialogPanelDescription>
          </DialogPanelHeader>
          {whatsAppReservation ? (
            <DialogPanelBody>
              <div className="whitespace-pre-line rounded-lg border border-emerald-200/70 bg-emerald-50/60 p-3 text-xs text-foreground">
                {generateWhatsAppMessage(whatsAppReservation, whatsAppType)}
              </div>
            </DialogPanelBody>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowWhatsAppDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={sendWhatsApp}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Send via WhatsApp
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
