import { describe, expect, it } from "vitest";
import {
  emptyReservationForm,
  filterCustomers,
  groupTablesByFloor,
  isReservationFormComplete,
  reservationPayload,
  sortByTimeSlot,
  statusFilterLabel,
  summarizeQueue,
  TIME_SLOT_OPTIONS,
  whatsAppMessage,
  whatsAppPhone,
} from "./reservation-rules";
import type { ReservationRow } from "./types";

const row = (over: Partial<ReservationRow>): ReservationRow => ({
  id: "r",
  table_id: null,
  customer_id: null,
  customer_name: "Budi",
  customer_phone: "0812-345",
  reservation_date: "2026-10-04",
  time_slot: "12:00:00",
  pax_count: 2,
  status: "pending",
  ...over,
});

describe("reservation rules", () => {
  it("slot waktu 10:00–21:00 per 30 menit", () => {
    expect(TIME_SLOT_OPTIONS).toHaveLength(23);
    expect(TIME_SLOT_OPTIONS[0]).toEqual({ value: "10:00", label: "10:00" });
    expect(TIME_SLOT_OPTIONS.at(-1)?.value).toBe("21:00");
    expect(TIME_SLOT_OPTIONS[5]?.value).toBe("12:30");
  });

  it("label filter status", () => {
    expect(statusFilterLabel("all")).toBe("All");
    expect(statusFilterLabel("seated")).toBe("Seated");
  });

  it("ringkasan antrian: dilayani terakhir, berikutnya terkecil, jumlah menunggu", () => {
    const summary = summarizeQueue([
      row({ id: "a", queue_number: 1, status: "completed" }),
      row({ id: "b", queue_number: 2, status: "seated" }),
      row({ id: "c", queue_number: 4, status: "pending" }),
      row({ id: "d", queue_number: 3, status: "confirmed" }),
      row({ id: "e", queue_number: null, status: "pending" }),
    ]);
    expect(summary.nowServing?.id).toBe("b");
    expect(summary.next?.id).toBe("d");
    expect(summary.waitingCount).toBe(2);
  });

  it("urut jam, filter customer, grup meja per lantai tanpa meja nonaktif", () => {
    expect(sortByTimeSlot([row({ id: "x", time_slot: "13:00" }), row({ id: "y", time_slot: "09:30" })]).map((r) => r.id)).toEqual([
      "y",
      "x",
    ]);
    expect(filterCustomers([{ id: "1", name: "Ana", phone: "0811" }, { id: "2", phone: "0899" }], "089").map((c) => c.id)).toEqual(["2"]);
    const groups = groupTablesByFloor([
      { id: "t10", label: "T10", floor: "1" },
      { id: "t2", label: "T2", floor: "1" },
      { id: "off", label: "X", floor: "1", is_active: false },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tables.map((t) => t.id)).toEqual(["t2", "t10"]);
  });

  it("form: wajib nama/tanggal/jam, payload memakai special_requests utk jenis order", () => {
    const form = emptyReservationForm("2026-10-05");
    expect(isReservationFormComplete(form)).toBe(false);
    const filled = { ...form, customerName: "  Sari ", customerPhone: " 0812 ", orderType: "takeaway" as const };
    expect(isReservationFormComplete(filled)).toBe(true);
    expect(reservationPayload(filled)).toMatchObject({
      customer_name: "Sari",
      customer_phone: "0812",
      reservation_date: "2026-10-05",
      time_slot: "12:00",
      pax_count: 2,
      special_requests: "takeaway",
    });
  });

  it("WhatsApp: nomor 08 → 62, pesan pengingat memuat meja & catatan", () => {
    expect(whatsAppPhone(row({}))).toBe("62812345");
    expect(whatsAppPhone(row({ customer_phone: null }))).toBeNull();
    const message = whatsAppMessage(row({ notes: "Ulang tahun", table: { table_number: "A1" } }), "reminder");
    expect(message).toContain("Hello Budi!");
    expect(message).toContain("Table: A1\nNotes: Ulang tahun\n");
    expect(message).toContain("Minggu, 4 Oktober 2026");
  });
});
