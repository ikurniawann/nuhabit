import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { todayInJakarta, validateVisitDateWindow } from "@/lib/ticketing/booking";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { countSlotUsedByDate, loadActiveSlots } from "@/lib/ticketing/capacity-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// EPIC-031 Fase D — endpoint PUBLIK: slot waktu venue utk satu tanggal.
// Kosong = venue tanpa timed-entry (wizard tanpa langkah slot). Status
// per slot hanya available|sold_out — TANPA angka (konsisten availability).

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(request.headers, "booking-slots", { limit: 30, windowMs: 60_000 });
    const { slug } = await params;
    const date = request.nextUrl.searchParams.get("date") ?? "";
    if (validateVisitDateWindow(date, todayInJakarta()) !== "ok") {
      throw ApiError.badRequest("Tanggal tidak valid");
    }

    const venue = await resolvePublicVenue(slug);
    if (!venue) throw ApiError.notFound("Not found");
    const scope = { companyId: venue.companyId, branchId: venue.branchId };
    const slots = await loadActiveSlots(scope);
    if (slots.length === 0) return successResponse({ slots: [] });

    const usedBySlot = await countSlotUsedByDate(scope, date);
    return successResponse({
      slots: slots.map((slot) => ({
        slot_id: slot.id,
        label: slot.label,
        start_time: slot.start_time.slice(0, 5),
        end_time: slot.end_time.slice(0, 5),
        status:
          slot.capacity !== null && (usedBySlot.get(slot.id) ?? 0) >= slot.capacity
            ? "sold_out"
            : "available",
      })),
    });
  },
  "public.booking.slots.GET"
);
